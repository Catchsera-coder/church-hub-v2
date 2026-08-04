<script lang="ts">
  import { goto } from '$app/navigation';
  import { api } from '$lib/api.js';
  import { t, locale, tr, LOCALES } from '$lib/i18n.js';

  let { initial = null, id = null }: { initial?: any; id?: number | null } = $props();

  let form = $state({
    givenName: initial?.givenName ?? {},
    familyName: initial?.familyName ?? {},
    membershipStatus: initial?.membershipStatus ?? 'visitor',
    email: initial?.email ?? '',
    mobile: initial?.mobile ?? '',
    preferredLanguage: initial?.preferredLanguage ?? 'en',
    isActive: initial?.isActive ?? true,
  });
  let saving = $state(false);
  let error = $state('');

  const statuses = ['visitor', 'regular', 'member', 'inactive'];

  async function submit(e: Event) {
    e.preventDefault();
    saving = true; error = '';
    try {
      const body = { ...form, email: form.email || null, mobile: form.mobile || null };
      if (id) await api(`/people/${id}`, { method: 'PUT', body: JSON.stringify(body) });
      else await api('/people', { method: 'POST', body: JSON.stringify(body) });
      await goto('/members');
    } catch (err) {
      error = (err as Error).message;
    } finally { saving = false; }
  }
</script>

<form class="max-w-2xl space-y-6" onsubmit={submit}>
  {#if error}<p class="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">{error}</p>{/if}

  <div class="card grid gap-4 p-6 sm:grid-cols-2">
    {#each LOCALES as l}
      <label class="block space-y-1">
        <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'First name', ar: 'الاسم الأول' }, $locale)} ({l.native})</span>
        <input class="input" dir={l.dir} bind:value={form.givenName[l.code]} />
      </label>
      <label class="block space-y-1">
        <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Last name', ar: 'اسم العائلة' }, $locale)} ({l.native})</span>
        <input class="input" dir={l.dir} bind:value={form.familyName[l.code]} />
      </label>
    {/each}
  </div>

  <div class="card grid gap-4 p-6 sm:grid-cols-2">
    <label class="block space-y-1">
      <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Status', ar: 'الحالة' }, $locale)}</span>
      <select class="input capitalize" bind:value={form.membershipStatus}>{#each statuses as s}<option value={s}>{s}</option>{/each}</select>
    </label>
    <label class="block space-y-1">
      <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Preferred language', ar: 'اللغة المفضلة' }, $locale)}</span>
      <select class="input" bind:value={form.preferredLanguage}>{#each LOCALES as l}<option value={l.code}>{l.native}</option>{/each}</select>
    </label>
    <label class="block space-y-1">
      <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Email', ar: 'البريد' }, $locale)}</span>
      <input class="input force-ltr" type="email" bind:value={form.email} />
    </label>
    <label class="block space-y-1">
      <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Mobile', ar: 'الجوال' }, $locale)}</span>
      <input class="input force-ltr" bind:value={form.mobile} />
    </label>
  </div>

  <div class="flex gap-3">
    <button class="btn-primary" type="submit" disabled={saving}>{saving ? $t('common.loading') : $t('common.save')}</button>
    <a class="btn-ghost" href="/members">✕</a>
  </div>
</form>
