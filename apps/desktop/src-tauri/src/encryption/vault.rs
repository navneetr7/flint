use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use std::sync::OnceLock;

#[cfg(target_os = "macos")]
use super::keychain::Keychain;

// Keychain entry — same key is used for all local encryption.
const KEYCHAIN_SERVICE: &str = "Flint AI Settings";
const KEYCHAIN_ACCOUNT: &str = "local";

// Cached in-process so we only hit the keychain subprocess once per run.
static CACHED_KEY: OnceLock<[u8; 32]> = OnceLock::new();

// Prefixes distinguish ciphertext types so we can detect legacy plaintext on read.
const SECRET_PREFIX: &str = "v1";
const FIELD_PREFIX: &str = "fv1";

pub struct LocalVault;

impl LocalVault {
    /// Encrypts a secret value (e.g. an API key). Produces a `v1:nonce:ciphertext` string.
    pub fn encrypt_secret(value: &str) -> Result<String, String> {
        let key = encryption_key()?;
        let (ciphertext, nonce) = aes_encrypt(&key, value.as_bytes())?;
        Ok(encode_payload(SECRET_PREFIX, &nonce, &ciphertext))
    }

    /// Decrypts a value produced by `encrypt_secret`.
    pub fn decrypt_secret(value: &str) -> Result<String, String> {
        let key = encryption_key()?;
        let (nonce, ciphertext) = decode_payload(value, SECRET_PREFIX)
            .ok_or_else(|| "Unsupported encrypted secret format".to_string())?;
        let plaintext = aes_decrypt(&key, &nonce, &ciphertext)?;
        String::from_utf8(plaintext).map_err(|_| "Decrypted secret is invalid UTF-8".to_string())
    }

    /// Encrypts a database field (e.g. window_title). Produces a `fv1:nonce:ciphertext` string.
    pub fn encrypt_field(value: &str) -> Result<String, String> {
        let key = encryption_key()?;
        let (ciphertext, nonce) = aes_encrypt(&key, value.as_bytes())?;
        Ok(encode_payload(FIELD_PREFIX, &nonce, &ciphertext))
    }

    /// Encrypts arbitrary bytes (e.g. a raw SQLite file for backup).
    /// Returns nonce (12 bytes) prepended to ciphertext as a single `Vec<u8>`.
    pub fn encrypt_bytes(data: &[u8]) -> Result<Vec<u8>, String> {
        let key = encryption_key()?;
        let (ciphertext, nonce) = aes_encrypt(&key, data)?;
        let mut out = Vec::with_capacity(12 + ciphertext.len());
        out.extend_from_slice(&nonce);
        out.extend_from_slice(&ciphertext);
        Ok(out)
    }

    /// Decrypts bytes produced by `encrypt_bytes` (nonce‖ciphertext).
    pub fn decrypt_bytes(data: &[u8]) -> Result<Vec<u8>, String> {
        if data.len() < 12 {
            return Err("Encrypted data is too short".to_string());
        }
        let (nonce, ciphertext) = data.split_at(12);
        let key = encryption_key()?;
        aes_decrypt(&key, nonce, ciphertext)
    }

    /// Generates a random 32-byte backup key and returns it alongside a human-readable
    /// display string formatted as 8 groups of 8 hex chars separated by dashes.
    pub fn generate_backup_key() -> Result<([u8; 32], String), String> {
        let mut key = [0u8; 32];
        getrandom::fill(&mut key).map_err(|e| format!("Unable to generate backup key: {e}"))?;
        let display = format_backup_key(&key);
        Ok((key, display))
    }

    /// Parses a backup key display string (dashes ignored) back into raw bytes.
    pub fn parse_backup_key(s: &str) -> Result<[u8; 32], String> {
        let hex: String = s.chars().filter(|c| c.is_ascii_hexdigit()).collect();
        if hex.len() != 64 {
            return Err("Invalid backup key: expected 64 hex characters".to_string());
        }
        let bytes: Result<Vec<u8>, _> = (0..64)
            .step_by(2)
            .map(|i| u8::from_str_radix(&hex[i..i + 2], 16))
            .collect();
        let bytes = bytes.map_err(|_| "Invalid backup key: bad hex encoding".to_string())?;
        bytes
            .try_into()
            .map_err(|_| "Invalid backup key length".to_string())
    }

    /// Encrypts bytes with a caller-supplied raw 32-byte key (for user-keyed backups).
    /// Returns nonce (12 bytes) prepended to ciphertext.
    pub fn encrypt_with_raw_key(data: &[u8], key: &[u8; 32]) -> Result<Vec<u8>, String> {
        let (ciphertext, nonce) = aes_encrypt(key, data)?;
        let mut out = Vec::with_capacity(12 + ciphertext.len());
        out.extend_from_slice(&nonce);
        out.extend_from_slice(&ciphertext);
        Ok(out)
    }

    /// Decrypts bytes produced by `encrypt_with_raw_key`.
    pub fn decrypt_with_raw_key(data: &[u8], key: &[u8; 32]) -> Result<Vec<u8>, String> {
        if data.len() < 12 {
            return Err("Encrypted data is too short".to_string());
        }
        let (nonce, ciphertext) = data.split_at(12);
        aes_decrypt(key, nonce, ciphertext)
    }

    /// Decrypts a field produced by `encrypt_field`.
    /// If the value has no encrypted prefix it is treated as legacy plaintext and returned as-is,
    /// so existing unencrypted rows continue to work without a data migration.
    pub fn decrypt_field(value: &str) -> Result<String, String> {
        if !value.starts_with(FIELD_PREFIX) {
            return Ok(value.to_string());
        }
        let key = encryption_key()?;
        let (nonce, ciphertext) = decode_payload(value, FIELD_PREFIX)
            .ok_or_else(|| "Invalid encrypted field format".to_string())?;
        let plaintext = aes_decrypt(&key, &nonce, &ciphertext)?;
        String::from_utf8(plaintext).map_err(|_| "Decrypted field is invalid UTF-8".to_string())
    }
}

fn aes_encrypt(key: &[u8; 32], plaintext: &[u8]) -> Result<(Vec<u8>, [u8; 12]), String> {
    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|_| "Unable to initialize encryption".to_string())?;
    let mut nonce_bytes = [0u8; 12];
    getrandom::fill(&mut nonce_bytes).map_err(|e| format!("Unable to generate nonce: {e}"))?;
    let ciphertext = cipher
        .encrypt(Nonce::from_slice(&nonce_bytes), plaintext)
        .map_err(|_| "Encryption failed".to_string())?;
    Ok((ciphertext, nonce_bytes))
}

fn aes_decrypt(key: &[u8; 32], nonce: &[u8], ciphertext: &[u8]) -> Result<Vec<u8>, String> {
    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|_| "Unable to initialize decryption".to_string())?;
    cipher
        .decrypt(Nonce::from_slice(nonce), ciphertext)
        .map_err(|_| "Decryption failed".to_string())
}

fn encode_payload(prefix: &str, nonce: &[u8], ciphertext: &[u8]) -> String {
    format!(
        "{}:{}:{}",
        prefix,
        BASE64.encode(nonce),
        BASE64.encode(ciphertext)
    )
}

/// Strips `prefix:` then splits the remainder on the first `:` to recover nonce and ciphertext.
fn decode_payload(value: &str, prefix: &str) -> Option<(Vec<u8>, Vec<u8>)> {
    let rest = value.strip_prefix(&format!("{prefix}:"))?;
    let (nonce_b64, ct_b64) = rest.split_once(':')?;
    let nonce = BASE64.decode(nonce_b64).ok()?;
    let ct = BASE64.decode(ct_b64).ok()?;
    Some((nonce, ct))
}

fn encryption_key() -> Result<[u8; 32], String> {
    if let Some(key) = CACHED_KEY.get() {
        return Ok(*key);
    }

    let key = load_key_from_keychain()?;
    let _ = CACHED_KEY.set(key);
    Ok(key)
}

fn load_key_from_keychain() -> Result<[u8; 32], String> {
    #[cfg(target_os = "macos")]
    {
        if let Some(existing) = Keychain::read(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT) {
            return decode_key(&existing);
        }

        let mut key = [0u8; 32];
        getrandom::fill(&mut key)
            .map_err(|e| format!("Unable to generate encryption key: {e}"))?;
        let encoded = BASE64.encode(key);
        Keychain::write(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT, &encoded)?;
        return Ok(key);
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err("Encrypted local storage currently requires macOS Keychain".to_string())
    }
}

fn format_backup_key(key: &[u8; 32]) -> String {
    let hex: String = key.iter().map(|b| format!("{b:02x}")).collect();
    hex.as_bytes()
        .chunks(8)
        .map(|c| std::str::from_utf8(c).unwrap())
        .collect::<Vec<_>>()
        .join("-")
}

fn decode_key(value: &str) -> Result<[u8; 32], String> {
    let bytes = BASE64
        .decode(value.trim())
        .map_err(|_| "Invalid local encryption key".to_string())?;
    bytes
        .try_into()
        .map_err(|_| "Invalid local encryption key length".to_string())
}
