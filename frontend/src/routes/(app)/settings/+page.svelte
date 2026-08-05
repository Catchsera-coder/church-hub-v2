<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api.js';
  import { t, locale, tr, LOCALES } from '$lib/i18n.js';
  import { hasRole } from '$lib/stores/auth.js';
  import PageHeader from '$lib/components/PageHeader.svelte';

  let form = $state<any>(null);
  let saving = $state(false);
  let saved = $state(false);

  // Messaging (Admin only)
  const isAdmin = hasRole('Admin') || hasRole('Super Admin');
  let msg = $state<any>(null);
  let msgSaving = $state(false);
  let msgSaved = $state(false);

  onMount(async () => {
    const r = await api<{ data: any }>('/settings');
    form = { ...r.data, name: r.data.name ?? {} };
    if (isAdmin) {
      const m = await api<{ data: any }>('/settings/messaging');
      // secret fields start blank; blank on save = leave unchanged
      msg = { ...m.data, sendgridApiKey: '', twilioAuthToken: '', acsConnectionString: '' };
    }
  });

  async function save(e: Event) {
    e.preventDefault();
    saving = true; saved = false;
    try {
      await api('/settings', { method: 'PUT', body: JSON.stringify({
        name: form.name, currency: form.currency, timezone: form.timezone, locale: form.locale,
        email: form.email, phone: form.phone, addressLine1: form.addressLine1, city: form.city,
        region: form.region, postalCode: form.postalCode, country: form.country,
      }) });
      saved = true;
    } finally { saving = false; }
  }

  async function saveMessaging(e: Event) {
    e.preventDefault();
    msgSaving = true; msgSaved = false;
    try {
      await api('/settings/messaging', { method: 'PUT', body: JSON.stringify({
        mailFrom: msg.mailFrom, sendgridApiKey: msg.sendgridApiKey,
        smsProvider: msg.smsProvider, smsFrom: msg.smsFrom,
        twilioAccountSid: msg.twilioAccountSid, twilioAuthToken: msg.twilioAuthToken,
        acsSmsFrom: msg.acsSmsFrom, acsConnectionString: msg.acsConnectionString,
      }) });
      msgSaved = true;
      // refresh the "set" indicators
      const m = await api<{ data: any }>('/settings/messaging');
      msg = { ...m.data, sendgridApiKey: '', twilioAuthToken: '', acsConnectionString: '' };
    } finally { msgSaving = false; }
  }

  const secretPlaceholder = (isSet: boolean) =>
    isSet ? tr({ en: '•••••••• (leave blank to keep)', ar: '•••••••• (اتركه فارغاً للإبقاء)' }, $locale)
          : tr({ en: 'Not set', ar: 'غير محدد' }, $locale);
</script>

<PageHeader title={$t('nav.settings')} />

{#if !form}
  <p class="text-slate-400">{$t('common.loading')}</p>
{:else}
  <form class="max-w-2xl space-y-6" onsubmit={save}>
    <div class="card space-y-4 p-6">
      <h2 class="text-lg font-semibold">{tr({ en: 'Identity', ar: 'الهوية' }, $locale)}</h2>
      {#each LOCALES as l}
        <label class="block space-y-1">
          <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Church name', ar: 'اسم الكنيسة' }, $locale)} ({l.native})</span>
          <input class="input" dir={l.dir} bind:value={form.name[l.code]} />
        </label>
      {/each}
    </div>

    <div class="card grid gap-4 p-6 sm:grid-cols-3">
      <label class="block space-y-1">
        <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Default language', ar: 'اللغة الافتراضية' }, $locale)}</span>
        <select class="input" bind:value={form.locale}>{#each LOCALES as l}<option value={l.code}>{l.native}</option>{/each}</select>
      </label>
      <label class="block space-y-1">
        <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Currency', ar: 'العملة' }, $locale)}</span>
        <input class="input force-ltr uppercase" maxlength="3" bind:value={form.currency} />
      </label>
      <label class="block space-y-1">
        <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Time zone', ar: 'المنطقة الزمنية' }, $locale)}</span>
        <input class="input force-ltr" bind:value={form.timezone} />
      </label>
    </div>

    <div class="card grid gap-4 p-6 sm:grid-cols-2">
      <h2 class="text-lg font-semibold sm:col-span-2">{tr({ en: 'Contact', ar: 'التواصل' }, $locale)}</h2>
      <label class="block space-y-1"><span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Email', ar: 'البريد' }, $locale)}</span><input class="input force-ltr" bind:value={form.email} /></label>
      <label class="block space-y-1"><span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Phone', ar: 'الهاتف' }, $locale)}</span><input class="input force-ltr" bind:value={form.phone} /></label>
      <label class="block space-y-1"><span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Address', ar: 'العنوان' }, $locale)}</span><input class="input" bind:value={form.addressLine1} /></label>
      <label class="block space-y-1"><span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'City', ar: 'المدينة' }, $locale)}</span><input class="input" bind:value={form.city} /></label>
    </div>

    <div class="flex items-center gap-3">
      <button class="btn-primary" type="submit" disabled={saving}>{saving ? $t('common.loading') : $t('common.save')}</button>
      {#if saved}<span class="text-sm text-emerald-600 dark:text-emerald-400">✓</span>{/if}
    </div>
  </form>

  {#if isAdmin && msg}
    <form class="mt-8 max-w-2xl space-y-6" onsubmit={saveMessaging}>
      <div class="card space-y-4 p-6">
        <div>
          <h2 class="text-lg font-semibold">{tr({ en: 'Messaging', ar: 'المراسلة' }, $locale)}</h2>
          <p class="text-sm text-slate-500 dark:text-slate-400">{tr({ en: 'Configure how this church sends email and SMS. Leave a secret blank to keep the current value.', ar: 'اضبط كيفية إرسال هذه الكنيسة للبريد والرسائل. اترك السر فارغاً للإبقاء على القيمة الحالية.' }, $locale)}</p>
        </div>

        <h3 class="text-sm font-semibold text-slate-700 dark:text-slate-200">{tr({ en: 'Email (SendGrid)', ar: 'البريد (SendGrid)' }, $locale)}</h3>
        <div class="grid gap-4 sm:grid-cols-2">
          <label class="block space-y-1">
            <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'From address', ar: 'عنوان المُرسِل' }, $locale)}</span>
            <input class="input force-ltr" type="email" bind:value={msg.mailFrom} placeholder="hello@church.org" />
          </label>
          <label class="block space-y-1">
            <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'SendGrid API key', ar: 'مفتاح SendGrid' }, $locale)}</span>
            <input class="input force-ltr" type="password" bind:value={msg.sendgridApiKey} placeholder={secretPlaceholder(msg.sendgridApiKeySet)} />
          </label>
        </div>

        <h3 class="text-sm font-semibold text-slate-700 dark:text-slate-200">{tr({ en: 'SMS', ar: 'الرسائل النصية' }, $locale)}</h3>
        <label class="block space-y-1">
          <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Provider', ar: 'المزود' }, $locale)}</span>
          <select class="input" bind:value={msg.smsProvider}>
            <option value="">{tr({ en: 'Auto / use deploy default', ar: 'تلقائي / الافتراضي' }, $locale)}</option>
            <option value="twilio">Twilio</option>
            <option value="azure">{tr({ en: 'Azure Communication Services', ar: 'Azure Communication Services' }, $locale)}</option>
          </select>
        </label>

        <div class="grid gap-4 sm:grid-cols-2">
          <label class="block space-y-1">
            <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'From number (E.164)', ar: 'رقم المُرسِل (E.164)' }, $locale)}</span>
            <input class="input force-ltr" bind:value={msg.smsFrom} placeholder="+15551234567" />
          </label>
        </div>

        <div class="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
          <p class="mb-3 text-xs font-medium uppercase tracking-wide text-slate-400">Twilio</p>
          <div class="grid gap-4 sm:grid-cols-2">
            <label class="block space-y-1">
              <span class="text-sm text-slate-600 dark:text-slate-300">Account SID</span>
              <input class="input force-ltr" bind:value={msg.twilioAccountSid} />
            </label>
            <label class="block space-y-1">
              <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Auth token', ar: 'رمز المصادقة' }, $locale)}</span>
              <input class="input force-ltr" type="password" bind:value={msg.twilioAuthToken} placeholder={secretPlaceholder(msg.twilioAuthTokenSet)} />
            </label>
          </div>
        </div>

        <div class="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
          <p class="mb-3 text-xs font-medium uppercase tracking-wide text-slate-400">Azure Communication Services</p>
          <div class="grid gap-4 sm:grid-cols-2">
            <label class="block space-y-1">
              <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'ACS number (E.164)', ar: 'رقم ACS (E.164)' }, $locale)}</span>
              <input class="input force-ltr" bind:value={msg.acsSmsFrom} placeholder="+15551234567" />
            </label>
            <label class="block space-y-1">
              <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Connection string', ar: 'سلسلة الاتصال' }, $locale)}</span>
              <input class="input force-ltr" type="password" bind:value={msg.acsConnectionString} placeholder={secretPlaceholder(msg.acsConnectionStringSet)} />
            </label>
          </div>
        </div>
      </div>

      <div class="flex items-center gap-3">
        <button class="btn-primary" type="submit" disabled={msgSaving}>{msgSaving ? $t('common.loading') : $t('common.save')}</button>
        {#if msgSaved}<span class="text-sm text-emerald-600 dark:text-emerald-400">✓</span>{/if}
      </div>
    </form>
  {/if}
{/if}
