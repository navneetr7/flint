import { useEffect, useState } from "react";
import { ArrowUpCircle, X } from "lucide-react";
import { checkForUpdate, openUrl, type UpdateInfo } from "@/shared/api/systemApi";

const CACHE_KEY = "flint_update_check";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export function UpdateBanner() {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      try {
        const { ts, data } = JSON.parse(cached);
        if (Date.now() - ts < CACHE_TTL_MS) {
          setUpdate(data);
          return;
        }
      } catch {}
    }

    checkForUpdate().then((info) => {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data: info }));
      setUpdate(info);
    }).catch(() => {});
  }, []);

  if (!update || dismissed) return null;

  return (
    <div className="update-banner">
      <ArrowUpCircle size={14} className="update-banner-icon" />
      <span>
        <strong>{update.version}</strong> is available
      </span>
      <button
        className="update-banner-download"
        type="button"
        onClick={() => openUrl(update.url)}
      >
        Download
      </button>
      <button
        className="update-banner-dismiss"
        type="button"
        aria-label="Dismiss"
        onClick={() => setDismissed(true)}
      >
        <X size={12} />
      </button>
    </div>
  );
}
