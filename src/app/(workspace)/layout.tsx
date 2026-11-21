import { redirect } from 'next/navigation';
import { session } from '@/server/auth';
import WorkspaceShell from '@/components/workspace-shell';

export const dynamic = 'force-dynamic';

export default async function Workspace({ children }: { children: React.ReactNode }) {
  const user = await session();
  if (!user) redirect('/login');
  if (user.mustChangePassword) redirect('/change-password');
  const common: [string, string][] = [['Overview', '/dashboard'], ['Audit management', '/audits'], ['My profile', '/profile']];
  const nav: [string, string][] = user.role === 'ADMIN'
    ? [...common, ['Google Sheets', '/google-sheets'], ['Adoption analysis', '/adoption'], ['Counsellors', '/counsellors'], ['Reports', '/reports'], ['Adoption settings', '/settings'], ['User management', '/users'], ['Teams', '/teams']]
    : user.role === 'MANAGER'
      ? [...common, ['Adoption analysis', '/adoption'], ['Reports', '/reports']]
      : user.role === 'COUNSELLOR'
        ? [...common, ['My adoption progress', '/adoption'], ['My history', '/reports']]
        : [...common, ['My submitted audits', '/counsellors'], ['My reports', '/reports']];
  return <WorkspaceShell nav={nav} name={user.name} role={user.role}>{children}</WorkspaceShell>;
}
