<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api.js';
  import { t, locale, tr } from '$lib/i18n.js';
  import { can } from '$lib/stores/auth.js';

  // Compact pastoral-care panel for one member: their open care items + quick add.
  let { personId }: { personId: number } = $props();
  const editable = can('create care');
  const canView = can('view care');

  const TYPES = [
    { v: 'prayer', en: 'Prayer', ar: 'صلاة', icon: '🙏' },
    { v: 'care', en: 'Care', ar: 'رعاية', icon: '❤️' },
    { v: 'visit', en: 'Visit', ar: 'زيارة', icon: '🚪' },
    { v: 'task', en: 'Task', ar: 'مهمة', icon: '✅' },
  ];
  const icon = (v: string) => TYPES.find((x) => x.v === v)?.icon ?? '🙏';

  let rows = $state<any[]>([]);
  let loading = $state(true);
  let adding = $state(false);
  let subject = $state('');
  let type = $state('prayer');
  let busy = $state(false);

  async function load() {
    loading = true;
    try { rows = (await api<{ data: any[] }>(`/care?personId=${personId}`)).data; } catch { rows = []; } finally { loading = false; }
  }
  onMount(() => { if (canView) load(); else loading = false; });

  async function add() {
    if (!subject.trim()) return;
    busy = true;
    try { await api('/care', { method: 'POST', body: JSON.stringify({ personId, type, subject: subject.trim() }) }); subject = ''; adding = false; await load(); }
    catch (err) { alert(err instanceof ApiError ? err.message : (err as Error).message); } finally { busy = false; }
  }
  async function done(r: any) {
    try { await api(`/care/${r.id}`, { method: 'PUT', body: JSON.stringify({ status: r.status === 'done' ? 'open' : 'done' }) }); await load(); }
    catch (err) { alert((err as Error).message); }
  }
</script>

{#if canView}
  <div class="card p-6">
    <div class="mb-3 flex items-center justify-between">
      <h2 class="font-semibold">❤️ {tr({ en: 'Pastoral care', ar: 'الرعاية' }, $locale)}</h2>
      {#if editable}<button class="btn-ghost text-sm" style="color: var(--brand)" onclick={() => (adding = !adding)}>{adding ? tr({ en: '✕', ar: '✕' }, $locale) : tr({ en: '+ Add', ar: '+ إضافة' }, $locale)}</button>{/if}
    </div>

    {#if adding}
      <div class="mb-3 space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
        <div class="flex flex-wrap gap-1">{#each TYPES as ty}<button type="button" class="rounded-md border px-2 py-1 text-xs {type === ty.v ? 'border-transparent text-white' : 'border-slate-300 dark:border-slate-700'}" style={type === ty.v ? 'background: var(--brand)' : ''} onclick={() => (type = ty.v)}>{ty.icon} {tr({ en: ty.en, ar: ty.ar }, $locale)}</button>{/each}</div>
        <div class="flex gap-2"><input class="input" bind:value={subject} placeholder={tr({ en: 'e.g. Prayer for healing', ar: 'مثال: صلاة للشفاء' }, $locale)} /><button class="btn-primary shrink-0" onclick={add} disabled={busy || !subject.trim()}>{tr({ en: 'Add', ar: 'إضافة' }, $locale)}</button></div>
      </div>
    {/if}

    {#if loading}
      <p class="text-sm text-slate-400">{$t('common.loading')}</p>
    {:else if rows.length === 0}
      <p class="rounded-lg bg-slate-50 px-3 py-4 text-center text-xs text-slate-500 dark:bg-slate-800/50">{tr({ en: 'No care items yet.', ar: 'لا عناصر رعاية بعد.' }, $locale)}</p>
    {:else}
      <ul class="space-y-1.5">
        {#each rows as r (r.id)}
          <li class="flex items-center gap-2 text-sm {r.status === 'done' ? 'opacity-60' : ''}">
            <span>{icon(r.type)}</span>
            <span class="min-w-0 flex-1 truncate {r.status === 'done' ? 'line-through' : ''}">{r.subject}</span>
            {#if r.dueOn}<span class="force-ltr text-xs text-slate-400">{r.dueOn}</span>{/if}
            {#if can('update care')}<button class="text-xs text-slate-400 hover:text-emerald-600" title={tr({ en: 'Toggle done', ar: 'تبديل الإنجاز' }, $locale)} onclick={() => done(r)}>{r.status === 'done' ? '↺' : '✓'}</button>{/if}
          </li>
        {/each}
      </ul>
      <a href="/care?person={personId}" class="mt-2 block text-xs text-slate-500 hover:underline">{tr({ en: 'Open in Care →', ar: 'فتح في الرعاية ←' }, $locale)}</a>
    {/if}
  </div>
{/if}
