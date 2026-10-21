import { createFileRoute, Outlet, useNavigate, useParams } from '@tanstack/react-router'
import { ModuleShell } from '@rawtoh/module-ui'
import { useAuth } from '@/hooks/use-auth'
import { MonitorIcon } from 'lucide-react'

export const Route = createFileRoute('/o/$orgSlug')({
  component: RouteComponent,
})

function RouteComponent() {
  const { orgSlug } = useParams({ strict: false })
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  return (
    <ModuleShell
      user={user ?? {}}
      orgs={user?.organizations ?? []}
      orgSlug={orgSlug}
      nav={[{ label: 'OBS accounts', icon: MonitorIcon, to: `/o/${orgSlug}`, active: true }]}
      onSelectOrg={(o) => navigate({ to: '/o/$orgSlug', params: { orgSlug: o.slug } })}
      onLogout={logout}
      resource="OBS accounts"
    >
      <Outlet />
    </ModuleShell>
  )
}
