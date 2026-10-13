import { getKnownGroupAccounts } from '@/lib/group-device';
import LoginForm from './LoginForm';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  return <LoginForm groupAccounts={await getKnownGroupAccounts()} />;
}
