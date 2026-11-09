import { useEffect, useState } from 'react';
import { joinPath } from '@beluga/shared/os-path.js';
import { FormSheet } from '../../components/FormSheet.js';
import { Button } from '../../components/ui.js';
import { inApp } from '../../lib/boot.js';
import { toast, useApi, useBeluga } from '../../lib/beluga.js';
import { type ShareInput, drawShare } from './share-image.js';
import s from './your-card.module.css';
import { t as tNow, useT } from '../../i18n/index.js';

const fileName = (): string => tNow('views.shareSheet.file');

/** Save the picture: the Save panel picks where (starting in Downloads) and the daemon writes it; outside the app, a download. */
async function savePicture(png: string, save: (b64: string, to: string) => Promise<unknown>): Promise<boolean> {
  if (!inApp()) {
    const a = document.createElement('a');
    a.href = png;
    a.download = fileName();
    a.click();
    return true;
  }
  const [{ save: savePanel }, { downloadDir }] = await Promise.all([import('@tauri-apps/plugin-dialog'), import('@tauri-apps/api/path')]);
  const dir = await downloadDir().catch(() => '');
  const to = await savePanel({ title: tNow('views.shareSheet.saveTitle'), defaultPath: dir ? joinPath(dir, fileName()) : fileName(), filters: [{ name: tNow('views.shareSheet.png'), extensions: ['png'] }] });
  if (!to) return false;
  await save(png.slice(png.indexOf(',') + 1), to.toLowerCase().endsWith('.png') ? to : `${to}.png`);
  return true;
}

/** Copy the picture, to paste it into a chat or a post. */
async function copyPicture(png: string): Promise<void> {
  const blob = await (await fetch(png)).blob();
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}

/**
 * Share your stats: the picture (share-image.ts) as it will be, Save Image… (the main action) and
 * Copy Image. Nothing is sent anywhere: you take it from here.
 */
export function ShareSheet({ input, onClose }: { input: ShareInput; onClose: () => void }) {
  const t = useT();
  const api = useApi();
  const { client } = useBeluga();
  const [png, setPng] = useState<string | undefined>(undefined);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let alive = true;
    void drawShare(input)
      .then((url) => alive && setPng(url))
      .catch((err: unknown) => toast(client, t('views.shareSheet.drawFailed', { error: err instanceof Error ? err.message : String(err) }), 'warn'));
    return () => {
      alive = false;
    };
  }, [input, client]);
  const copy = (): void => {
    if (!png) return;
    copyPicture(png)
      .then(() => setCopied(true))
      .catch(() => toast(client, t('views.shareSheet.copyFailed'), 'warn'));
  };
  return (
    <FormSheet
      title={t('views.shareSheet.title')}
      intro={t('views.shareSheet.intro')}
      icon="share"
      width={560}
      submitLabel={t('views.shareSheet.save')}
      canSubmit={Boolean(png)}
      onSubmit={async () => {
        if (!png) return;
        if (await savePicture(png, (b64, to) => api.stats.saveImage(b64, to))) {
          toast(client, t('views.shareSheet.saved'), 'success');
          onClose();
        }
      }}
      onCancel={onClose}
      footer={
        <Button variant="plain" icon={copied ? 'check' : 'copy'} onClick={copy} disabled={!png}>
          {copied ? t('views.reader.copied') : t('views.shareSheet.copy')}
        </Button>
      }
    >
      <div className={s.sharePreview}>{png ? <img src={png} alt={t('views.shareSheet.alt')} /> : <span className={s.shareDrawing} />}</div>
    </FormSheet>
  );
}
