<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { t, locale, tr } from '$lib/i18n.js';

  const token = $page.params.token;
  const base = `/api/public/unsubscribe/${token}`;

  let loading = $state(true);
  let notFound = $state(false);
  let name = $state('');
  let emailOptOut = $state(false);
  let smsOptOut = $state(false);
  let whatsappOptOut = $state(false);
  let saving = $state(false);
  let saved = $state(false);

  onMount(async () => {
    try {
      const res = await fetch(base);
      if (!res.ok) { notFound = true; return; }
      const d = (await res.json()).data;
      name = d.name; emailOptOut = d.emailOptOut; smsOptOut = d.smsOptOut; whatsappOptOut = d.whatsappOptOut;
    } catch { notFound = true; } finally { loading = false; }
  });

  async function save() {
    saving = true; saved = false;
    try {
      await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ emailOptOut, smsOptOut, whatsappOptOut }) });
      saved = true;
    } finally { saving = false; }
  }

  async function unsubAll() {
    emailOptOut = true; smsOptOut = true; whatsappOptOut = true;
    await save();
  }
</script>

<div class="mx-auto max-w-md px-4 py-12">
  {#if loading}
    <p class="text-center text-slate-400">{$t('common.loading')}</p>
  {:else if notFound}
    <div class="card p-8 text-center"><p>{tr({ en: 'This link is no longer valid.', ar: 'هذا الرابط لم يعد صالحاً.' }, $locale)}</p></div>
  {:else}
    <div class="card space-y-4 p-6">
      <h1 class="text-xl font-bold">{tr({ en: 'Message preferences', ar: 'تفضيلات الرسائل' }, $locale)}</h1>
      {#if name}<p class="text-sm text-slate-500">{name}</p>{/if}
      <p class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Choose what you want to stop receiving:', ar: 'اختر ما تريد إيقاف تلقّيه:' }, $locale)}</p>
      <label class="flex items-center gap-2"><input type="checkbox" bind:checked={emailOptOut} /> {tr({ en: 'Stop emails', ar: 'إيقاف البريد' }, $locale)}</label>
      <label class="flex items-center gap-2"><input type="checkbox" bind:checked={smsOptOut} /> {tr({ en: 'Stop SMS', ar: 'إيقاف الرسائل النصية' }, $locale)}</label>
      <label class="flex items-center gap-2"><input type="checkbox" bind:checked={whatsappOptOut} /> {tr({ en: 'Stop WhatsApp', ar: 'إيقاف واتساب' }, $locale)}</label>
      <div class="flex items-center gap-3 pt-2">
        <button class="btn-primary" onclick={save} disabled={saving}>{saving ? $t('common.loading') : $t('common.save')}</button>
        <button class="btn-ghost" onclick={unsubAll} disabled={saving}>{tr({ en: 'Unsubscribe from all', ar: 'إلغاء الاشتراك من الكل' }, $locale)}</button>
        {#if saved}<span class="text-sm text-emerald-600 dark:text-emerald-400">✓ {tr({ en: 'Saved', ar: 'تم الحفظ' }, $locale)}</span>{/if}
      </div>
    </div>
  {/if}
</div>
