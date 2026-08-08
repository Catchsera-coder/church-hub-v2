<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { api } from '$lib/api.js';
  import { auth, setSession, clearSession, isAuthed, can, hasRole } from '$lib/stores/auth.js';
  import { t, locale, tr, arabicEnabled } from '$lib/i18n.js';
  import { theme, toggleTheme } from '$lib/stores/appearance.js';
  import { applyBrandColor } from '$lib/stores/brand.js';
  import Icon from '$lib/components/Icon.svelte';

  let { children } = $props();
  let orgName = $state<Record<string, string> | null>(null);
  let logo = $state<string | null>(null);
  let ready = $state(false);
  let sidebarOpen = $state(false);

  const groups = [
    {
      key: 'group.congregation',
      items: [
        { href: '/members', label: 'nav.members', icon: 'members', perm: 'view person' },
        { href: '/families', label: 'nav.families', icon: 'families', perm: 'view household' },
      ],
    },
    {
      key: 'group.gatherings',
      items: [
        { href: '/attendance', label: 'nav.attendance', icon: 'attendance', perm: 'view attendance' },
        { href: '/checkin', label: 'nav.checkin', icon: 'checkin', perm: 'create attendance' },
        { href: '/forms', label: 'nav.forms', icon: 'forms', role: 'Admin' },
        { href: '/ministries', label: 'nav.ministries', icon: 'ministries', perm: 'view ministry' },
      ],
    },
    {
      key: 'group.giving',
      items: [
        { href: '/contributions', label: 'nav.contributions', icon: 'contributions', perm: 'view contribution' },
        { href: '/counting', label: 'nav.counting', icon: 'counting', perm: 'view batch' },
        { href: '/funds', label: 'nav.funds', icon: 'funds', perm: 'view fund' },
      ],
    },
    {
      key: 'group.teaching',
      items: [
        { href: '/sermons', label: 'nav.sermons', icon: 'sermons', perm: 'view sermon' },
        { href: '/events', label: 'nav.events', icon: 'events', perm: 'view event' },
      ],
    },
    {
      key: 'group.communication',
      items: [
        { href: '/messages', label: 'nav.messages', icon: 'messages', perm: 'view message' },
        { href: '/messages/templates', label: 'nav.templates', icon: 'sermons', perm: 'view message' },
        { href: '/automations', label: 'nav.automations', icon: 'automations', role: 'Admin' },
      ],
    },
    {
      key: 'group.admin',
      items: [
        { href: '/team', label: 'nav.team', icon: 'team', perm: 'view user' },
        { href: '/activity', label: 'nav.activity', icon: 'activity', role: 'Admin' },
        { href: '/settings', label: 'nav.settings', icon: 'settings', role: 'Admin' },
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
    try {
      const me = await api<{ user: any; roles: string[]; perms: string[] }>('/auth/me');
      setSession({ user: me.user, roles: me.roles, perms: me.perms });
      const s = await api<{ data: { name: Record<string, string>; logoPath?: string | null; arabicEnabled?: boolean; brandColor?: string | null } }>('/settings');
      orgName = s.data.name;
      logo = s.data.logoPath ?? null;
      applyBrandColor(s.data.brandColor);
      // Default is English; only allow Arabic when the church has enabled it.
      arabicEnabled.set(!!s.data.arabicEnabled);
      if (!s.data.arabicEnabled && $locale !== 'en') locale.set('en');
    } catch {
      clearSession();
      return goto('/login', { replaceState: true });
    }
    ready = true;
  });

  async function signOut() {
    try { await api('/auth/logout', { method: 'POST', body: JSON.stringify({ refreshToken: $auth.refreshToken }) }); } catch { /* ignore */ }
    clearSession();
    goto('/login', { replaceState: true });
  }

  const isActive = (href: string) => $page.url.pathname === href || $page.url.pathname.startsWith(href + '/');
  // On mobile the sidebar is an overlay drawer; close it after choosing a link.
  const closeSidebar = () => (sidebarOpen = false);
</script>

{#if ready}
  <div class="flex h-full">
    <!-- Mobile drawer backdrop -->
    {#if sidebarOpen}
      <button
        class="fixed inset-0 z-30 bg-black/40 md:hidden"
        onclick={closeSidebar}
        aria-label={tr({ en: 'Close menu', ar: 'إغلاق القائمة' }, $locale)}
      ></button>
    {/if}

    <!-- Sidebar (static on md+, overlay drawer on mobile when open) -->
    <aside class="hidden w-64 shrink-0 overflow-y-auto border-e border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 md:block {sidebarOpen ? '!block fixed inset-y-0 start-0 z-40 shadow-xl md:!static md:!z-auto md:!shadow-none' : ''}">
      <div class="mb-6 flex items-center gap-2 px-2">
        {#if logo}
          <img src={logo} alt="" class="h-8 w-8 object-contain" />
        {:else}
          <div class="grid h-8 w-8 place-items-center rounded-lg font-display text-white" style="background-color: var(--brand)">✦</div>
        {/if}
        <span class="font-display text-lg font-semibold">{orgName ? tr(orgName, $locale) : $t('app.name')}</span>
      </div>
      <nav class="space-y-5">
        <a href="/dashboard" class="nav-link {isActive('/dashboard') ? 'nav-link-active' : ''}" onclick={closeSidebar}>
          <Icon name="dashboard" />{$t('nav.dashboard')}
        </a>
        {#each groups as g}
          {@const items = g.items.filter(visible)}
          {#if items.length}
            <div>
              <p class="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{$t(g.key)}</p>
              <div class="space-y-1">
                {#each items as item}
                  <a href={item.href} class="nav-link {isActive(item.href) ? 'nav-link-active' : ''}" onclick={closeSidebar}>
                    <Icon name={item.icon} />{$t(item.label)}
                  </a>
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
        <button class="btn-ghost md:hidden" onclick={() => (sidebarOpen = !sidebarOpen)} aria-label={tr({ en: 'Menu', ar: 'القائمة' }, $locale)}>☰</button>
        <div class="flex-1"></div>
        <div class="flex items-center gap-2">
          <button class="btn-ghost" onclick={toggleTheme} aria-label={tr({ en: 'Theme', ar: 'النمط' }, $locale)}>{$theme === 'dark' ? '☀' : '☾'}</button>
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
