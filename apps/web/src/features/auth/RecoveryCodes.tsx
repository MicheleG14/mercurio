import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * The recovery codes, shown once. Continuing requires an explicit "I saved them": the codes are
 * the only way back in if the authenticator app is lost.
 */
export function RecoveryCodes({ codes, onDone }: { codes: readonly string[]; onDone: () => void }) {
  const { t } = useTranslation('auth');
  const { t: tc } = useTranslation();
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const text = codes.join('\n');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // Clipboard blocked: the codes are still on screen and can be downloaded.
    }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([`${text}\n`], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = t('recovery.fileName');
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card className="mx-auto w-full max-w-md">
      <CardHeader>
        <CardTitle>
          <h1 className="text-lg font-semibold">{t('recovery.title')}</h1>
        </CardTitle>
        <CardDescription>{t('recovery.description')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ul className="bg-muted grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg p-3 font-mono text-sm">
          {codes.map((code) => (
            <li key={code}>{code}</li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => void copy()}>
            {copied ? tc('actions.copied') : t('recovery.copy')}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={download}>
            {t('recovery.download')}
          </Button>
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-4"
            checked={saved}
            onChange={(event) => setSaved(event.target.checked)}
          />
          {t('recovery.confirm')}
        </label>
        <Button type="button" disabled={!saved} onClick={onDone}>
          {t('recovery.submit')}
        </Button>
      </CardContent>
    </Card>
  );
}
