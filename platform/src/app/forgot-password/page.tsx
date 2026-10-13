import { getKnownGroupAccounts } from '@/lib/group-device';
import ForgotPasswordForm from './ForgotPasswordForm';

export const dynamic = 'force-dynamic';

export default async function ForgotPasswordPage() {
  return <ForgotPasswordForm groupAccounts={await getKnownGroupAccounts()} />;
}
