import { createFileRoute, Link } from '@tanstack/react-router'
import { useOrg } from '@/hooks/use-auth'
import {
  useAccounts,
  useCreateAccount,
  useUpdateAccount,
  useInstallAccount,
  useSetCredentials,
  useDeleteCredentials,
  useRemoveAccount,
  useConnectionStatus,
  useAccountStatus,
  useDisconnectAccount,
  useReconnectAccount,
  usePingAccount,
} from '@/hooks/use-accounts'
import { startAgent, stopAgent, useAgentActive } from '@/hooks/use-agent'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ArrowLeftIcon, PlusIcon, TrashIcon, KeyIcon, UnplugIcon, PlugIcon, ActivityIcon, MonitorIcon, TriangleAlertIcon, PencilIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import type { Account } from '@module-obs/shared/validation'

export const Route = createFileRoute('/o/$orgSlug/')({
  component: RouteComponent,
})

function RouteComponent() {
  const org = useOrg()
  const { data: accounts, isLoading } = useAccounts(org.id)
  useConnectionStatus(org.id)
  const createAccount = useCreateAccount(org.id)
  const removeAccount = useRemoveAccount(org.id)
  const [addOpen, setAddOpen] = useState(false)

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-8 py-6 sm:py-8">
      <div className="flex items-center gap-3 sm:gap-4 mb-6">
        <Link to="/">
          <Button variant="ghost" size="icon">
            <ArrowLeftIcon />
          </Button>
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold truncate">{org.name}</h1>
          <p className="text-muted-foreground text-sm">OBS accounts</p>
        </div>
      </div>

      <div className="flex justify-end mb-4">
        <Button onClick={() => setAddOpen(true)} className="w-full sm:w-auto">
          <PlusIcon />
          Add OBS account
        </Button>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : !accounts || accounts.length === 0 ? (
        <p className="text-muted-foreground">No OBS accounts yet.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {accounts.map((account) => (
            <AccountCard
              key={account.id}
              orgId={org.id}
              account={account}
              onRemove={() =>
                removeAccount.mutate(account.id, {
                  onSuccess: () => toast.success('Account removed'),
                  onError: (err) => toast.error(err.message),
                })
              }
            />
          ))}
        </div>
      )}

      <AccountSheet
        open={addOpen}
        onOpenChange={setAddOpen}
        onSubmit={(body) =>
          createAccount.mutate(body, {
            onSuccess: () => {
              toast.success('OBS account added')
              setAddOpen(false)
            },
            onError: (err) => toast.error(err.message),
          })
        }
        pending={createAccount.isPending}
      />
    </div>
  )
}

function AccountCard({
  orgId,
  account,
  onRemove,
}: {
  orgId: string
  account: Account
  onRemove: () => void
}) {
  const [credentialsOpen, setCredentialsOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const { data: status } = useAccountStatus(orgId, account.id)
  const hubConnected = status?.hub.connected ?? false
  const hubReason = status?.hub.reason ?? null
  const obsState = status?.obs ?? 'disconnected'
  const agentActive = useAgentActive(account.id)
  const updateAccount = useUpdateAccount(orgId)
  const installAccount = useInstallAccount(orgId)
  const disconnectAccount = useDisconnectAccount(orgId)
  const reconnectAccount = useReconnectAccount(orgId)
  const pingAccount = usePingAccount(orgId)

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-4 min-w-0">
              <div className="flex-shrink-0 flex items-center justify-center w-12 h-12 rounded-xl bg-indigo-500/10">
                <MonitorIcon className="w-6 h-6 text-indigo-500" />
              </div>
              <div className="min-w-0">
                <CardTitle className="text-lg font-semibold truncate">{account.name}</CardTitle>
                <CardDescription className="truncate">{account.host}:{account.port}</CardDescription>
              </div>
              <div className="flex flex-col gap-1.5 flex-shrink-0">
                {!account.hasCredentials ? (
                  <Badge variant="outline" className="border-yellow-500/40 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 gap-1.5 px-2.5 py-1">
                    <TriangleAlertIcon className="h-3.5 w-3.5" />
                    Not installed
                  </Badge>
                ) : hubReason === 'key-rotated' && !hubConnected ? (
                  <Badge variant="outline" className="border-yellow-500/40 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 gap-1.5 px-2.5 py-1">
                    <TriangleAlertIcon className="h-3.5 w-3.5" />
                    Key rotated
                  </Badge>
                ) : (
                  <Badge variant="outline" className={`gap-1.5 px-2.5 py-1 ${hubConnected ? 'border-green-500/40 bg-green-500/10 text-green-600 dark:text-green-400' : 'border-gray-400/40 bg-gray-400/10 text-muted-foreground'}`}>
                    <span className={`w-2 h-2 rounded-full ${hubConnected ? 'bg-green-500' : 'bg-gray-400'}`} />
                    {hubConnected ? 'Hub online' : 'Hub offline'}
                  </Badge>
                )}
                <Badge variant="outline" className={`gap-1.5 px-2.5 py-1 ${
                  obsState === 'connected'
                    ? 'border-green-500/40 bg-green-500/10 text-green-600 dark:text-green-400'
                    : obsState === 'connecting'
                      ? 'border-yellow-500/40 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400'
                      : obsState === 'error'
                        ? 'border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400'
                        : 'border-gray-400/40 bg-gray-400/10 text-muted-foreground'
                }`}>
                  <span className={`w-2 h-2 rounded-full ${
                    obsState === 'connected' ? 'bg-green-500' : obsState === 'connecting' ? 'bg-yellow-500' : obsState === 'error' ? 'bg-red-500' : 'bg-gray-400'
                  }`} />
                  {obsState === 'connected' ? 'OBS connected' : obsState === 'connecting' ? 'OBS connecting…' : obsState === 'error' ? 'OBS error' : 'OBS offline'}
                </Badge>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {agentActive ? (
                <Button variant="outline" size="sm" onClick={() => stopAgent(account.id)}>
                  <UnplugIcon className="h-4 w-4" />
                  Disconnect OBS
                </Button>
              ) : (
                <Button variant="outline" size="sm" onClick={() => startAgent(orgId, account.id)}>
                  <MonitorIcon className="h-4 w-4" />
                  Connect OBS
                </Button>
              )}
              {!account.hasCredentials && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={installAccount.isPending}
                  onClick={() =>
                    installAccount.mutate(account.id, {
                      onSuccess: (data) => {
                        if (data.warning) toast.warning(data.warning)
                        else toast.success('Installed with Rawtoh')
                      },
                      onError: (err) => toast.error(err.message),
                    })
                  }
                >
                  <PlugIcon className="h-4 w-4" />
                  {installAccount.isPending ? 'Installing…' : 'Install with Rawtoh'}
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => setCredentialsOpen(true)}>
                <KeyIcon className="h-4 w-4" />
                Credentials
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setEditOpen(true)}>
                <PencilIcon className="h-4 w-4" />
                Edit
              </Button>
              {account.hasCredentials && (
                <>
                  {hubConnected ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        disconnectAccount.mutate(account.id, {
                          onSuccess: () => toast.success('Hub disconnected'),
                          onError: (err) => toast.error(err.message),
                        })
                      }
                    >
                      <UnplugIcon className="h-4 w-4" />
                      Disconnect hub
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        reconnectAccount.mutate(account.id, {
                          onSuccess: () => toast.success('Reconnecting...'),
                          onError: (err) => toast.error(err.message),
                        })
                      }
                    >
                      <PlugIcon className="h-4 w-4" />
                      Connect hub
                    </Button>
                  )}
                  {hubConnected && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={pingAccount.isPending}
                      onClick={() =>
                        pingAccount.mutate(account.id, {
                          onSuccess: (data) => toast.success(`Pong! ${data.latency}ms`),
                          onError: (err) => toast.error(err.message),
                        })
                      }
                    >
                      <ActivityIcon className="h-4 w-4" />
                      {pingAccount.isPending ? '...' : 'Ping'}
                    </Button>
                  )}
                </>
              )}
              <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={onRemove} title="Remove account">
                <TrashIcon className="h-4 w-4" />
              </Button>
            </div>
          </div>
          {agentActive && obsState === 'connected' && (
            <p className="mt-3 text-sm text-muted-foreground">
              OBS is connected through this browser tab — keep it open.
            </p>
          )}
          {hubReason === 'key-rotated' && !hubConnected && (
            <p className="mt-3 text-sm text-yellow-600 dark:text-yellow-400">
              This account was re-enrolled in Rawtoh, so its signing key is no longer trusted. Enroll again with a fresh token.
            </p>
          )}
        </CardHeader>
      </Card>

      <AccountSheet
        account={account}
        open={editOpen}
        onOpenChange={setEditOpen}
        onSubmit={({ password, ...rest }) =>
          // Blank password on edit = keep the current one
          updateAccount.mutate(
            { accountId: account.id, ...rest, ...(password !== '' ? { password } : {}) },
            {
              onSuccess: () => {
                toast.success('Account updated')
                setEditOpen(false)
              },
              onError: (err) => toast.error(err.message),
            },
          )
        }
        pending={updateAccount.isPending}
      />

      <CredentialsSheet
        orgId={orgId}
        account={account}
        open={credentialsOpen}
        onOpenChange={setCredentialsOpen}
      />
    </>
  )
}

function AccountSheet({
  account,
  open,
  onOpenChange,
  onSubmit,
  pending,
}: {
  account?: Account
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (body: { name: string; host: string; port: number; password: string }) => void
  pending: boolean
}) {
  const [name, setName] = useState('')
  const [host, setHost] = useState('127.0.0.1')
  const [port, setPort] = useState('4455')
  const [password, setPassword] = useState('')
  const [loadedFor, setLoadedFor] = useState<string | null>(null)

  // Reset/prefill the form each time the sheet opens
  const key = `${open}-${account?.id ?? 'new'}`
  if (key !== loadedFor) {
    setLoadedFor(key)
    setName(account?.name ?? '')
    setHost(account?.host ?? '127.0.0.1')
    setPort(String(account?.port ?? 4455))
    setPassword('')
  }

  const portNum = parseInt(port, 10)
  const valid = name.trim() !== '' && host.trim() !== '' && Number.isInteger(portNum) && portNum >= 1 && portNum <= 65535

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>{account ? `Edit — ${account.name}` : 'Add an OBS account'}</SheetTitle>
          <SheetDescription>
            obs-websocket connection settings (OBS → Tools → WebSocket Server Settings).
          </SheetDescription>
        </SheetHeader>
        <form
          className="px-4 flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (!valid) return
            onSubmit({ name: name.trim(), host: host.trim(), port: portNum, password })
          }}
        >
          <Input placeholder="Name (e.g. Gaming PC)" value={name} onChange={(e) => setName(e.target.value)} />
          <Input placeholder="Host" value={host} onChange={(e) => setHost(e.target.value)} className="font-mono" />
          <Input placeholder="Port" value={port} onChange={(e) => setPort(e.target.value)} className="font-mono" inputMode="numeric" />
          <Input
            type="password"
            placeholder={account?.hasPassword ? 'Password (leave blank to keep current)' : 'Password (optional)'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="font-mono"
          />
          <Button type="submit" disabled={!valid || pending}>
            {pending ? 'Saving…' : 'Save'}
          </Button>
        </form>
        <SheetFooter>
          <SheetClose asChild>
            <Button variant="ghost">Close</Button>
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

function CredentialsSheet({
  orgId,
  account,
  open,
  onOpenChange,
}: {
  orgId: string
  account: Account
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const installAccount = useInstallAccount(orgId)
  const setCredentials = useSetCredentials(orgId)
  const deleteCredentials = useDeleteCredentials(orgId)
  const [enrollmentToken, setEnrollmentToken] = useState('')

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>Rawtoh instance — {account.name}</SheetTitle>
          <SheetDescription>
            {account.hasCredentials
              ? `Instance ID: ${account.instanceId}`
              : 'This account is not enrolled in Rawtoh yet.'}
          </SheetDescription>
        </SheetHeader>
        <div className="px-4 flex flex-col gap-4">
          {!account.hasCredentials && (
            <div className="flex flex-col items-start gap-2">
              <Button
                disabled={installAccount.isPending}
                onClick={() =>
                  installAccount.mutate(account.id, {
                    onSuccess: (data) => {
                      if (data.warning) toast.warning(data.warning)
                      else toast.success('Installed with Rawtoh')
                      onOpenChange(false)
                    },
                    onError: (err) => toast.error(err.message),
                  })
                }
              >
                <PlugIcon className="h-4 w-4" />
                {installAccount.isPending ? 'Installing…' : 'Install with Rawtoh'}
              </Button>
              <p className="text-muted-foreground text-sm">
                Provisions the module instance in Rawtoh automatically using your account.
              </p>
            </div>
          )}
          <details className="text-sm">
            <summary className="text-muted-foreground cursor-pointer">Enrollment token (advanced)</summary>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (!enrollmentToken.trim()) return
                setCredentials.mutate(
                  { accountId: account.id, enrollmentToken: enrollmentToken.trim() },
                  {
                    onSuccess: (data) => {
                      if (data.warning) toast.warning(data.warning)
                      else toast.success('Enrolled')
                      setEnrollmentToken('')
                      onOpenChange(false)
                    },
                    onError: (err) => toast.error(err.message),
                  }
                )
              }}
              className="mt-3 flex flex-col gap-3"
            >
              <Input
                placeholder="Enrollment token (rth_e_...)"
                value={enrollmentToken}
                onChange={(e) => setEnrollmentToken(e.target.value)}
                className="font-mono"
              />
              <p className="text-muted-foreground text-xs">
                From Rawtoh → Module instances → Get enrollment token. Single use, valid 15 minutes.
              </p>
              <Button type="submit" disabled={!enrollmentToken.trim() || setCredentials.isPending}>
                Enroll
              </Button>
            </form>
          </details>
        </div>
        <SheetFooter>
          {account.hasCredentials && (
            <Button
              variant="outline"
              onClick={() =>
                deleteCredentials.mutate(account.id, {
                  onSuccess: () => {
                    toast.success('Signing key deleted')
                    onOpenChange(false)
                  },
                  onError: (err) => toast.error(err.message),
                })
              }
            >
              Delete signing key
            </Button>
          )}
          <SheetClose asChild>
            <Button variant="ghost">Close</Button>
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
