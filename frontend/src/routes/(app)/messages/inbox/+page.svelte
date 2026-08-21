<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { api } from '$lib/api.js';
  import { t, locale, tr, displayName } from '$lib/i18n.js';
  import { nameOrder } from '$lib/stores/prefs.js';
  import { can } from '$lib/stores/auth.js';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import PageHint from '$lib/components/PageHint.svelte';
  import { dateTime } from '$lib/format.js';

  const editable = can('update message');
  let rows = $state<any[]>([]);
  let loading = $state(true);
  let onlyOpen = $state(true);

  async function load() {
    loading = true;
    try { rows = (await api<{ data: any[] }>(`/messages/inbox${onlyOpen ? '?handled=false' : ''}`)).data; }
    finally { loading = false; }
  }
  onMount(load);

  async function toggleHandled(r: any) {
    try { await api(`/messages/inbox/${r.id}`, { method: 'PUT', body: JSON.stringify({ handled: !r.handled }) }); await load(); }
    catch (err) { alert((err as Error).message); }
  }
  function reply(r: any) {
    if (r.personId) goto(`/messages/new?people=${r.personId}`);
    else goto('/messages/new');
  }
</script>

<PageHeader title={tr({ en: 'SMS Inbox', ar: 'صندوق الرسائل' }, $locale)}>
  {#snippet actions()}
    <button class="btn-ghost border border-slate-300 text-sm dark:border-slate-700" onclick={() => { onlyOpen = !onlyOpen; load(); }}>{onlyOpen ? tr({ en: 'Show all', ar: 'إظهار الكل' }, $locale) : tr({ en: 'Only unhandled', ar: 'غير المعالَجة فقط' }, $locale)}</button>
  {/snippet}
</PageHeader>

<PageHint id="sms-inbox" text={{ en: 'Incoming text replies land here. Reply from the composer, and mark each as handled once dealt with. Texts that say STOP automatically opt that person out of SMS (START opts them back in). Point your Twilio number’s incoming-message webhook at /api/public/sms/inbound to receive replies.', ar: 'تصل ردود الرسائل النصية هنا. رد من المُنشئ، وميّز كلاً كمُعالَج. من يرسل STOP يُستبعد تلقائياً من الرسائل (وSTART يعيده). وجّه ويب هوك الرسائل الواردة في تويليو إلى /api/public/sms/inbound.' }} />

{#if loading}
  <p class="text-slate-400">{$t('common.loading')}</p>
{:else if rows.length === 0}
  <div class="card p-10 text-center text-slate-500">{tr({ en: 'No incoming messages yet.', ar: 'لا رسائل واردة بعد.' }, $locale)}</div>
{:else}
  <div class="space-y-2">
    {#each rows as r (r.id)}
      <div class="card p-4 {r.handled ? 'opacity-60' : ''}">
        <div class="flex flex-wrap items-start gap-3">
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              {#if r.personId}
                <a class="font-medium text-primary-700 hover:underline dark:text-primary-300" href="/members/{r.personId}">{displayName({ givenName: r.givenName, familyName: r.familyName }, $nameOrder, $locale)}</a>
              {:else}
                <span class="force-ltr font-medium">{r.fromNumber}</span>
                <span class="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">{tr({ en: 'unknown number', ar: 'رقم غير معروف' }, $locale)}</span>
              {/if}
              <span class="force-ltr text-xs text-slate-400">{r.fromNumber}</span>
              <span class="ms-auto text-xs text-slate-400">{dateTime(r.receivedAt)}</span>
            </div>
            <p class="mt-1 whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200">{r.body}</p>
          </div>
          {#if editable}
            <div class="flex shrink-0 items-center gap-1">
              <button class="btn-ghost text-xs" onclick={() => reply(r)}>↩ {tr({ en: 'Reply', ar: 'رد' }, $locale)}</button>
              <button class="btn-ghost text-xs {r.handled ? '' : 'text-emerald-700 dark:text-emerald-300'}" onclick={() => toggleHandled(r)}>{r.handled ? tr({ en: 'Reopen', ar: 'إعادة فتح' }, $locale) : tr({ en: '✓ Handled', ar: '✓ معالَج' }, $locale)}</button>
            </div>
          {/if}
        </div>
      </div>
    {/each}
  </div>
{/if}
