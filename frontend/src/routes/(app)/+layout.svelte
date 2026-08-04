<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { api } from '$lib/api.js';
  import { auth, setSession, clearSession, isAuthed, can, hasRole } from '$lib/stores/auth.js';
  import { t, locale, tr, LOCALES, type Locale } from '$lib/i18n.js';

  let { children } = $props();
  let orgName = $state<Record<string, string> | null>(null);
  let ready = $state(false);
  let dark = $state(false);
  let sidebarOpen = $state(false);

  const groups = [
    {
      key: 'group.congregation',
      items: [
        { href: '/members', label: 'nav.members', perm: 'view person' },
        { href: '/families', label: 'nav.families', perm: 'view household' },
      ],
    },
    {
      key: 'group.gatherings',
      items: [
        { href: '/attendance', label: 'nav.attendance', perm: 'view attendance' },
        { href: '/checkin', label: 'nav.checkin', perm: 'create attendance' },
        { href: '/ministries', label: 'nav.ministries', perm: 'view ministry' },
      ],
    },
    {
      key: 'group.giving',
      items: [
        { href: '/contributions', label: 'nav.contributions', perm: 'view contribution' },
        { href: '/counting', label: 'nav.counting', perm: 'view batch' },
        { href: '/funds', label: 'nav.funds', perm: 'view fund' },
      ],
    },
    {
      key: 'group.teaching',
      items: [
        { href: '/sermons', label: 'nav.sermons', perm: 'view sermon' },
        { href: '/events', label: 'nav.events', perm: 'view event' },
      ],
    },
    {
      key: 'group.communication',
      items: [{ href: '/messages', label: 'nav.messages', perm: 'view message' }],
    },
    {
      key: 'group.admin',
      items: [
        { href: '/team', label: 'nav.team', perm: 'view user' },
        { href: '/activity', label: 'nav.activity', role: 'Admin' },
        { href: '/settings', label: 'nav.settings', role: 'Admin' },
      ],
    },
  ];

  function visible(item: { perm?: string; role?: string }): boolean {
    if (item.role) return hasRole(item.role);
    if (item.perm) return can(item.perm);
    return true;
  }

  onMount(async () => {
    if (!isAuthed()) return goto('/login', { replaceState: true });
    dark = localStorage.getItem('theme') === 'dark';
    applyDark();
    try {
      const me = await api<{ user: any; roles: string[]; perms: string[] }>('/auth/me');
      setSession({ user: me.user, roles: me.roles, perms: me.perms });
      const s = await api<{ data: { name: Record<string, string> } }>('/settings');
      orgName = s.data.name;
    } catch {
      clearSession();
      return goto('/login', { replaceState: true });
    }
    ready = true;
  });

  function applyDark() {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('theme', dark ? 'dark' : 'light');
  }
  function toggleDark() { dark = !dark; applyDark(); }

  async function signOut() {
    try { await api('/auth/logout', { method: 'POST', body: JSON.stringify({ refreshToken: $auth.refreshToken }) }); } catch { /* ignore */ }
    clearSession();
    goto('/login', { replaceState: true });
  }

  const isActive = (href: string) => $page.url.pathname === href || $page.url.pathname.startsWith(href + '/');
</script>

{#if ready}
  <div class="flex h-full">
    <!-- Sidebar -->
    <aside class="hidden w-64 shrink-0 border-e border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 md:block {sidebarOpen ? '!block fixed inset-y-0 z-40' : ''}">
      <div class="mb-6 flex items-center gap-2 px-2">
        <div class="grid h-8 w-8 place-items-center rounded-lg bg-primary-600 font-display text-white">✦</div>
        <span class="font-display text-lg font-semibold">{orgName ? tr(orgName, $locale) : $t('app.name')}</span>
      </div>
      <nav class="space-y-5">
        <a href="/dashboard" class="nav-link {isActive('/dashboard') ? 'nav-link-active' : ''}">{$t('nav.dashboard')}</a>
        {#each groups as g}
          {@const items = g.items.filter(visible)}
          {#if items.length}
            <div>
              <p class="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{$t(g.key)}</p>
              <div class="space-y-1">
                {#each items as item}
                  <a href={item.href} class="nav-link {isActive(item.href) ? 'nav-link-active' : ''}">{$t(item.label)}</a>
                {/each}
              </div>
            </div>
          {/if}
        {/each}
      </nav>
    </aside>

    <!-- Main -->
    <div class="flex min-w-0 flex-1 flex-col">
      <header class="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
        <button class="btn-ghost md:hidden" onclick={() => (sidebarOpen = !sidebarOpen)} aria-label="Menu">☰</button>
        <div class="flex-1"></div>
        <div class="flex items-center gap-2">
          <select
            class="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900"
            value={$locale}
            onchange={(e) => locale.set((e.currentTarget as HTMLSelectElement).value as Locale)}
          >
            {#each LOCALES as l}<option value={l.code}>{l.native}</option>{/each}
          </select>
          <button class="btn-ghost" onclick={toggleDark} aria-label="Theme">{dark ? '☀' : '☾'}</button>
          <div class="flex items-center gap-2 ps-2">
            <span class="hidden text-sm text-slate-600 dark:text-slate-300 sm:inline">{$auth.user?.name}</span>
            <button class="btn-ghost" onclick={signOut}>{$t('auth.signout')}</button>
          </div>
        </div>
      </header>

      <main class="flex-1 overflow-y-auto p-4 md:p-6">
        {@render children()}
      </main>
    </div>
  </div>
{:else}
  <div class="grid h-full place-items-center text-slate-400">{$t('common.loading')}</div>
{/if}
