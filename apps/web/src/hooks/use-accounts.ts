import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { query } from '@/api/client'
import type { Account } from '@module-obs/shared/validation'
import type { ObsAgentState } from '@module-obs/shared/obs'

export interface AccountStatus {
  hub: { connected: boolean; reason: string | null }
  obs: ObsAgentState
}

const DEFAULT_STATUS: AccountStatus = {
  hub: { connected: false, reason: null },
  obs: 'disconnected',
}

export function useAccounts(orgId: string) {
  return useQuery({
    queryKey: ['accounts', orgId],
    queryFn: () => query.get(`api/orgs/${orgId}/accounts`).json<Account[]>(),
  })
}

export function useCreateAccount(orgId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { name: string; host: string; port: number; password: string }) =>
      query.post(`api/orgs/${orgId}/accounts`, { json: body }).json<Account>(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['accounts', orgId] }),
  })
}

export function useUpdateAccount(orgId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ accountId, ...body }: { accountId: string; name?: string; host?: string; port?: number; password?: string }) =>
      query.patch(`api/orgs/${orgId}/accounts/${accountId}`, { json: body }).json<Account>(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['accounts', orgId] }),
  })
}

export function useRemoveAccount(orgId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (accountId: string) =>
      query.delete(`api/orgs/${orgId}/accounts/${accountId}`).json(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['accounts', orgId] }),
  })
}

export function useInstallAccount(orgId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (accountId: string) =>
      query.post(`api/orgs/${orgId}/accounts/${accountId}/install`).json<{ ok: boolean; warning?: string; error?: string }>(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['accounts', orgId] }),
  })
}

export function useSetCredentials(orgId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ accountId, enrollmentToken }: { accountId: string; enrollmentToken: string }) =>
      query.put(`api/orgs/${orgId}/accounts/${accountId}/credentials`, { json: { enrollmentToken } }).json<{ ok: boolean; warning?: string; error?: string }>(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['accounts', orgId] }),
  })
}

export function useDeleteCredentials(orgId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (accountId: string) =>
      query.delete(`api/orgs/${orgId}/accounts/${accountId}/credentials`).json(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['accounts', orgId] }),
  })
}

export function useConnectionStatus(orgId: string) {
  const qc = useQueryClient()
  const eventSourceRef = useRef<EventSource | null>(null)

  useEffect(() => {
    const es = new EventSource(`/api/orgs/${orgId}/accounts/events`)
    eventSourceRef.current = es

    es.onmessage = (e) => {
      const data = JSON.parse(e.data)
      if (data.type === 'init') {
        for (const account of data.accounts) {
          qc.setQueryData(['account-status', orgId, account.accountId], {
            hub: account.hub,
            obs: account.obs,
          })
        }
      } else if (data.type === 'status') {
        qc.setQueryData(['account-status', orgId, data.accountId], {
          hub: data.hub,
          obs: data.obs,
        })
      }
    }

    return () => {
      es.close()
      eventSourceRef.current = null
    }
  }, [orgId, qc])
}

// Read-only subscription to the cache populated by useConnectionStatus SSE stream — no fetching needed
export function useAccountStatus(orgId: string, accountId: string) {
  return useQuery({
    queryKey: ['account-status', orgId, accountId],
    queryFn: () => DEFAULT_STATUS,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    enabled: false,
  })
}

export function useDisconnectAccount(orgId: string) {
  return useMutation({
    mutationFn: (accountId: string) =>
      query.post(`api/orgs/${orgId}/accounts/${accountId}/disconnect`).json(),
  })
}

export function useReconnectAccount(orgId: string) {
  return useMutation({
    mutationFn: (accountId: string) =>
      query.post(`api/orgs/${orgId}/accounts/${accountId}/reconnect`).json(),
  })
}

export function usePingAccount(orgId: string) {
  return useMutation({
    mutationFn: (accountId: string) =>
      query.post(`api/orgs/${orgId}/accounts/${accountId}/ping`).json<{ latency: number }>(),
  })
}
