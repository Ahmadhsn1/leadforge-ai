import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

/**
 * Root: send signed-in users straight to the dashboard, everyone else to the
 * sign-in screen. There is no public marketing page in this deployment.
 */
export default async function RootPage() {
  const cookieStore = await cookies();
  const hasSession = cookieStore.has('leadforge_session');
  redirect(hasSession ? '/dashboard' : '/login');
}
