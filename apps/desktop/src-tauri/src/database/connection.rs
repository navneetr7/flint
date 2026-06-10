use rusqlite::{Connection, Result};
use std::time::Duration;
use std::{env, fs, path::PathBuf};

use super::migrations::run_migrations;

pub struct DatabaseConnection {
    connection: Connection,
}

impl DatabaseConnection {
    pub fn open_local() -> Result<Self> {
        let path = database_path();
        let connection = Connection::open(path)?;
        connection.busy_timeout(Duration::from_secs(5))?;
        connection.pragma_update(None, "foreign_keys", "ON")?;
        connection.pragma_update(None, "journal_mode", "WAL")?;
        connection.pragma_update(None, "synchronous", "NORMAL")?;
        run_migrations(&connection)?;

        Ok(Self { connection })
    }

    pub fn connection(&self) -> &Connection {
        &self.connection
    }

    /// Reads the current database file as raw bytes after checkpointing the WAL.
    /// Used for backup export.
    pub fn backup_bytes(&self) -> Result<Vec<u8>> {
        self.connection
            .execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")?;
        let path = database_path();
        std::fs::read(&path).map_err(|e| {
            rusqlite::Error::ToSqlConversionFailure(
                std::io::Error::new(std::io::ErrorKind::Other, format!("Read failed: {e}")).into(),
            )
        })
    }

    /// Replaces the database file with the given bytes and reopens the connection.
    /// The caller must validate that `sqlite_bytes` is a valid SQLite database before calling.
    pub fn replace_with_backup(&mut self, sqlite_bytes: &[u8]) -> Result<()> {
        self.connection
            .execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")?;

        let path = database_path();
        std::fs::write(&path, sqlite_bytes).map_err(|e| {
            rusqlite::Error::ToSqlConversionFailure(
                std::io::Error::new(std::io::ErrorKind::Other, format!("Write failed: {e}")).into(),
            )
        })?;

        let fresh = Connection::open(&path)?;
        fresh.busy_timeout(Duration::from_secs(5))?;
        fresh.pragma_update(None, "foreign_keys", "ON")?;
        fresh.pragma_update(None, "journal_mode", "WAL")?;
        fresh.pragma_update(None, "synchronous", "NORMAL")?;
        run_migrations(&fresh)?;

        self.connection = fresh;
        Ok(())
    }
}

fn database_path() -> PathBuf {
    let directory = data_directory();
    let _ = fs::create_dir_all(&directory);

    directory.join("flint.local.sqlite")
}

fn data_directory() -> PathBuf {
    if let Some(path) = env::var_os("ATTUNE_DATA_DIR") {
        return PathBuf::from(path);
    }

    #[cfg(target_os = "macos")]
    {
        return env::var_os("HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("."))
            .join("Library")
            .join("Application Support")
            .join("Flint");
    }

    #[cfg(target_os = "windows")]
    {
        return env::var_os("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("."))
            .join("Flint");
    }

    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    {
        if let Some(path) = env::var_os("XDG_DATA_HOME") {
            return PathBuf::from(path).join("flint");
        }

        env::var_os("HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".local")
            .join("share")
            .join("flint")
    }
}
