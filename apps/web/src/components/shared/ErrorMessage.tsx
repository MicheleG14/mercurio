import { Alert } from '@/components/ui/alert';
import { useErrorText } from './useErrorText';

export function ErrorMessage({ error }: { error: unknown }) {
  const text = useErrorText();
  if (!error) return null;
  return <Alert variant="destructive">{text(error)}</Alert>;
}
