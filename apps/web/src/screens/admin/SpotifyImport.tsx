import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { roundFromTracks, type Language, type Round, type SpotifyPlaylist, type SpotifyStatus, type SpotifyTrack } from "@kwistig/shared";
import { api, RequestError } from "../../lib/api";

export function SpotifyImportButton({ language, onAdd }: { language: Language; onAdd: (round: Round) => void }) {
  const { t } = useTranslation();
  const [connected, setConnected] = useState(false);
  const [open, setOpen] = useState(false);
  const [lists, setLists] = useState<SpotifyPlaylist[] | null>(null);
  const [picked, setPicked] = useState<SpotifyPlaylist | null>(null);
  const [tracks, setTracks] = useState<SpotifyTrack[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<SpotifyStatus>("/spotify/status")
      .then((s) => setConnected(s.connected))
      .catch(() => setConnected(false));
  }, []);

  const fail = (err: unknown) => setError(t(`spotify.errors.${err instanceof RequestError ? err.code : "spotify_api_error"}`, { defaultValue: t("errors.generic") }));

  const start = () => {
    setOpen(true);
    setPicked(null);
    setTracks(null);
    setError(null);
    api<SpotifyPlaylist[]>("/spotify/playlists").then(setLists).catch(fail);
  };

  const pick = (p: SpotifyPlaylist) => {
    setPicked(p);
    setTracks(null);
    api<SpotifyTrack[]>(`/spotify/playlists/${p.id}/tracks`)
      .then((tr) => {
        setTracks(tr);
        setSelected(new Set(tr.map((x) => x.uri)));
      })
      .catch(fail);
  };

  if (!connected) return null;
  return (
    <>
      <button type="button" className="btn-ghost w-full" onClick={start}>
        + {t("spotify.importRound")}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label={t("spotify.importRound")}>
          <div className="card flex max-h-[85vh] w-full max-w-lg flex-col gap-3 p-5">
            <h2 className="text-lg font-bold">{picked ? picked.name : t("spotify.pickPlaylist")}</h2>
            {error && <p className="text-sm text-red-300">{error}</p>}

            {!picked && (
              <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto">
                {lists === null && !error && <li className="text-ink-400">{t("common.loading")}</li>}
                {lists?.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      disabled={!p.importable}
                      onClick={() => pick(p)}
                      className="flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {p.image ? <img src={p.image} alt="" className="h-10 w-10 rounded object-cover" /> : <span className="h-10 w-10 rounded bg-ink-700" />}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">{p.name}</span>
                        <span className="block truncate text-xs text-ink-400">
                          {p.importable ? t("spotify.trackCount", { count: p.trackCount ?? 0 }) : t("spotify.notOwned", { owner: p.owner })}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {picked && (
              <>
                <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto">
                  {tracks === null && !error && <li className="text-ink-400">{t("common.loading")}</li>}
                  {tracks?.map((tr) => (
                    <li key={tr.uri}>
                      <label className="flex items-center gap-3 rounded p-1.5 hover:bg-ink-800">
                        <input
                          type="checkbox"
                          className="accent-amber-400"
                          checked={selected.has(tr.uri)}
                          onChange={(e) => {
                            const next = new Set(selected);
                            if (e.target.checked) next.add(tr.uri);
                            else next.delete(tr.uri);
                            setSelected(next);
                          }}
                        />
                        <span className="min-w-0 flex-1 truncate text-sm">
                          <strong>{tr.artists.join(", ")}</strong> — {tr.name}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-ink-400">{t("spotify.importHint")}</p>
                <div className="flex gap-2">
                  <button type="button" className="btn-ghost" onClick={() => setPicked(null)}>
                    ← {t("common.back")}
                  </button>
                  <button
                    type="button"
                    className="btn-primary ml-auto"
                    disabled={!tracks || selected.size === 0}
                    onClick={() => {
                      onAdd(roundFromTracks(picked.name, (tracks ?? []).filter((x) => selected.has(x.uri)), language));
                      setOpen(false);
                    }}
                  >
                    {t("spotify.addRound", { count: selected.size })}
                  </button>
                </div>
              </>
            )}
            <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>
              {t("common.close")}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
