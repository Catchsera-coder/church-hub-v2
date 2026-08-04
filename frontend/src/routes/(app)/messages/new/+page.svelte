<script lang="ts">
  import { goto } from '$app/navigation';
  import { api } from '$lib/api.js';
  import { t, locale, tr, LOCALES } from '$lib/i18n.js';
  import PageHeader from '$lib/components/PageHeader.svelte';

  let form = $state({
    name: '',
    channel: 'email' as 'email' | 'sms',
    subject: {} as Record<string, string>,
    body: {} as Record<string, string>,
  });
  let error = $state('');
  let saving = $state(false);

  async function submit(e: Event) {
    e.preventDefault();
    saving = true; error = '';
    try {
      const { data } = await api<{ data: any }>('/messages', { method: 'POST', body: JSON.stringify(form) });
      await goto(`/messages?created=${data.id}`);
    } catch (err) { error = (err as Error).message; } finally { saving = false; }
  }
</script>

<PageHeader title={tr({ en: 'New message', ar: 'رسالة جديدة' }, $locale)} />

<form class="max-w-2xl space-y-6" onsubmit={submit}>
  {#if error}<p class="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">{error}</p>{/if}
  <div class="card space-y-4 p-6">
    <div class="grid grid-cols-2 gap-3">
      <label class="block space-y-1">
        <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Internal name', ar: 'اسم داخلي' }, $locale)}</span>
        <input class="input" bind:value={form.name} required placeholder={tr({ en: 'e.g. Sunday reminder', ar: 'مثال: تذكير الأحد' }, $locale)} />
      </label>
      <label class="block space-y-1">
        <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Channel', ar: 'القناة' }, $locale)}</span>
        <select class="input" bind:value={form.channel}>
          <option value="email">{tr({ en: 'Email', ar: 'بريد إلكتروني' }, $locale)}</option>
          <option value="sms">{tr({ en: 'SMS', ar: 'رسالة نصية' }, $locale)}</option>
        </select>
      </label>
    </div>

    {#if form.channel === 'email'}
      {#each LOCALES as l}
        <label class="block space-y-1">
          <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Subject', ar: 'الموضوع' }, $locale)} ({l.native})</span>
          <input class="input" dir={l.dir} bind:value={form.subject[l.code]} />
        </label>
      {/each}
    {/if}

    {#each LOCALES as l}
      <label class="block space-y-1">
        <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Message', ar: 'الرسالة' }, $locale)} ({l.native})</span>
        <textarea class="input" dir={l.dir} rows="4" bind:value={form.body[l.code]} required={l.code === 'en'}></textarea>
      </label>
    {/each}
  </div>

  <p class="text-xs text-slate-500 dark:text-slate-400">
    {tr({ en: 'Recipients are active members with a matching contact detail. Save the draft, then use "Send now" from the list.', ar: 'المستلمون هم الأعضاء النشطون الذين لديهم بيانات اتصال مطابقة. احفظ المسودة ثم استخدم «إرسال الآن» من القائمة.' }, $locale)}
  </p>

  <div class="flex gap-3">
    <button class="btn-primary" type="submit" disabled={saving}>{saving ? $t('common.loading') : $t('common.save')}</button>
    <a class="btn-ghost" href="/messages">✕</a>
  </div>
</form>
