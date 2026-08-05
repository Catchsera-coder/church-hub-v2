<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api.js';
  import { t, locale, tr, LOCALES } from '$lib/i18n.js';
  import { hasRole } from '$lib/stores/auth.js';
  import { theme, fontScale, boldText } from '$lib/stores/appearance.js';
  import PageHeader from '$lib/components/PageHeader.svelte';

  const SIZES = [
    { v: 0.9, label: { en: 'Small', ar: 'صغير' } },
    { v: 1, label: { en: 'Normal', ar: 'عادي' } },
    { v: 1.15, label: { en: 'Large', ar: 'كبير' } },
    { v: 1.3, label: { en: 'Extra large', ar: 'كبير جداً' } },
  ];

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
      msg = { ...m.data, sendgridApiKey: '', twilioAuthToken: '', acsConnectionString: '', aiApiKey: '' };
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
        logoPath: form.logoPath ?? null, arabicEnabled: !!form.arabicEnabled,
      }) });
      saved = true;
      // If Arabic was just disabled, drop back to English immediately.
      if (!form.arabicEnabled && $locale !== 'en') locale.set('en');
    } finally { saving = false; }
  }

  function onLogoFile(e: Event) {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { alert(tr({ en: 'Please choose an image file.', ar: 'اختر ملف صورة.' }, $locale)); return; }
    if (file.size > 512 * 1024) { alert(tr({ en: 'Logo must be under 512 KB.', ar: 'يجب أن يكون الشعار أقل من 512 كيلوبايت.' }, $locale)); return; }
    const reader = new FileReader();
    reader.onload = () => { form.logoPath = reader.result as string; };
    reader.readAsDataURL(file);
  }

  // Language options: English always; Arabic only when the church enabled it.
  const langOptions = $derived(LOCALES.filter((l) => l.code === 'en' || form?.arabicEnabled));

  async function saveMessaging(e: Event) {
    e.preventDefault();
    msgSaving = true; msgSaved = false;
    try {
      await api('/settings/messaging', { method: 'PUT', body: JSON.stringify({
        emailProvider: msg.emailProvider, mailFrom: msg.mailFrom, acsMailFrom: msg.acsMailFrom,
        sendgridApiKey: msg.sendgridApiKey,
        smsProvider: msg.smsProvider, smsFrom: msg.smsFrom,
        twilioAccountSid: msg.twilioAccountSid, twilioAuthToken: msg.twilioAuthToken,
        acsSmsFrom: msg.acsSmsFrom, acsConnectionString: msg.acsConnectionString,
        whatsappFrom: msg.whatsappFrom, aiModel: msg.aiModel, aiApiKey: msg.aiApiKey,
      }) });
      msgSaved = true;
      // refresh the "set" indicators
      const m = await api<{ data: any }>('/settings/messaging');
      msg = { ...m.data, sendgridApiKey: '', twilioAuthToken: '', acsConnectionString: '', aiApiKey: '' };
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

      <!-- Logo (shown on login + sidebar). Uses only the file you upload. -->
      <div class="flex items-center gap-4">
        <div class="grid h-16 w-16 place-items-center overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
          {#if form.logoPath}<img src={form.logoPath} alt="" class="h-full w-full object-contain" />{:else}<span class="text-2xl text-slate-300">✦</span>{/if}
        </div>
        <div class="space-y-1">
          <span class="block text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Church logo', ar: 'شعار الكنيسة' }, $locale)}</span>
          <input type="file" accept="image/*" onchange={onLogoFile} class="text-sm" />
          {#if form.logoPath}<button type="button" class="ms-2 text-xs text-rose-600 hover:underline" onclick={() => (form.logoPath = null)}>{$t('common.delete')}</button>{/if}
          <p class="text-xs text-slate-400">{tr({ en: 'PNG/SVG, under 512 KB. Save to apply.', ar: 'PNG/SVG أقل من 512 كيلوبايت. احفظ للتطبيق.' }, $locale)}</p>
        </div>
      </div>

      {#each langOptions as l}
        <label class="block space-y-1">
          <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Church name', ar: 'اسم الكنيسة' }, $locale)} ({l.native})</span>
          <input class="input" dir={l.dir} bind:value={form.name[l.code]} />
        </label>
      {/each}
    </div>

    <div class="card space-y-4 p-6">
      <h2 class="text-lg font-semibold">{tr({ en: 'Language', ar: 'اللغة' }, $locale)}</h2>
      <label class="flex items-center gap-2 text-sm">
        <input type="checkbox" bind:checked={form.arabicEnabled} />
        {tr({ en: 'Enable Arabic (default is English)', ar: 'تفعيل العربية (الافتراضي الإنجليزية)' }, $locale)}
      </label>
      <div class="grid gap-4 sm:grid-cols-2">
        <label class="block space-y-1">
          <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Display language', ar: 'لغة العرض' }, $locale)}</span>
          <select class="input" value={$locale} onchange={(e) => locale.set((e.currentTarget as HTMLSelectElement).value as any)}>
            {#each langOptions as l}<option value={l.code}>{l.native}</option>{/each}
          </select>
        </label>
        <label class="block space-y-1">
          <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Default for new users', ar: 'الافتراضي للمستخدمين الجدد' }, $locale)}</span>
          <select class="input" bind:value={form.locale}>{#each langOptions as l}<option value={l.code}>{l.native}</option>{/each}</select>
        </label>
      </div>
    </div>

    <div class="card space-y-4 p-6">
      <h2 class="text-lg font-semibold">{tr({ en: 'Appearance', ar: 'المظهر' }, $locale)}</h2>
      <p class="text-sm text-slate-500 dark:text-slate-400">{tr({ en: 'Applies to this device.', ar: 'يُطبّق على هذا الجهاز.' }, $locale)}</p>

      <div class="space-y-1">
        <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Theme', ar: 'النمط' }, $locale)}</span>
        <div class="flex gap-2">
          <button type="button" class="btn {$theme === 'light' ? 'btn-primary' : 'btn-ghost border border-slate-300 dark:border-slate-700'}" onclick={() => theme.set('light')}>☀ {tr({ en: 'Light', ar: 'فاتح' }, $locale)}</button>
          <button type="button" class="btn {$theme === 'dark' ? 'btn-primary' : 'btn-ghost border border-slate-300 dark:border-slate-700'}" onclick={() => theme.set('dark')}>☾ {tr({ en: 'Dark', ar: 'داكن' }, $locale)}</button>
        </div>
      </div>

      <div class="space-y-1">
        <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Text size', ar: 'حجم الخط' }, $locale)}</span>
        <div class="flex flex-wrap gap-2">
          {#each SIZES as s}
            <button type="button" class="btn {$fontScale === s.v ? 'btn-primary' : 'btn-ghost border border-slate-300 dark:border-slate-700'}" onclick={() => fontScale.set(s.v)}>{tr(s.label, $locale)}</button>
          {/each}
        </div>
      </div>

      <label class="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={$boldText} onchange={(e) => boldText.set((e.currentTarget as HTMLInputElement).checked)} />
        {tr({ en: 'Bold text', ar: 'خط عريض' }, $locale)}
      </label>
    </div>

    <div class="card grid gap-4 p-6 sm:grid-cols-2">
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

        <h3 class="text-sm font-semibold text-slate-700 dark:text-slate-200">{tr({ en: 'Email', ar: 'البريد الإلكتروني' }, $locale)}</h3>
        <label class="block space-y-1">
          <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Email provider', ar: 'مزود البريد' }, $locale)}</span>
          <select class="input" bind:value={msg.emailProvider}>
            <option value="">{tr({ en: 'Auto / use deploy default', ar: 'تلقائي / الافتراضي' }, $locale)}</option>
            <option value="acs">{tr({ en: 'Azure Communication Services', ar: 'Azure Communication Services' }, $locale)}</option>
            <option value="sendgrid">SendGrid</option>
          </select>
          <span class="text-xs text-slate-400">{tr({ en: 'Your Azure ACS is already set up — choose it, add the sender + connection string below, and password-reset emails will send.', ar: 'خدمة Azure ACS جاهزة — اخترها وأضف المُرسِل وسلسلة الاتصال بالأسفل، وستُرسَل رسائل إعادة التعيين.' }, $locale)}</span>
        </label>
        <div class="grid gap-4 sm:grid-cols-2">
          <label class="block space-y-1">
            <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'ACS sender address', ar: 'عنوان مُرسِل ACS' }, $locale)}</span>
            <input class="input force-ltr" type="email" bind:value={msg.acsMailFrom} placeholder="DoNotReply@your-domain.azurecomm.net" />
          </label>
          <label class="block space-y-1">
            <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'SendGrid — from address', ar: 'SendGrid — عنوان المُرسِل' }, $locale)}</span>
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

      <div class="card space-y-4 p-6">
        <h3 class="font-semibold">{tr({ en: 'WhatsApp', ar: 'واتساب' }, $locale)}</h3>
        <p class="text-xs text-slate-500 dark:text-slate-400">{tr({ en: 'Uses your Twilio account above. Enter your WhatsApp-enabled sender.', ar: 'يستخدم حساب Twilio أعلاه. أدخل مرسل واتساب المفعّل.' }, $locale)}</p>
        <label class="block space-y-1">
          <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'WhatsApp sender', ar: 'مرسل واتساب' }, $locale)}</span>
          <input class="input force-ltr" bind:value={msg.whatsappFrom} placeholder="whatsapp:+14155238886" />
        </label>
      </div>

      <div class="card space-y-4 p-6">
        <h3 class="font-semibold">✨ {tr({ en: 'AI compose', ar: 'الصياغة بالذكاء الاصطناعي' }, $locale)}</h3>
        <p class="text-xs text-slate-500 dark:text-slate-400">{tr({ en: 'Add an Anthropic API key to draft messages from a short brief. Left blank, the AI compose button is disabled.', ar: 'أضف مفتاح Anthropic لصياغة الرسائل من وصف قصير. إذا تُرك فارغاً، يتعطّل زر الصياغة.' }, $locale)}{#if msg.envAiDefault} {tr({ en: '(An environment key is already active.)', ar: '(مفتاح بيئة مفعّل بالفعل.)' }, $locale)}{/if}</p>
        <label class="block space-y-1">
          <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Anthropic API key', ar: 'مفتاح Anthropic' }, $locale)}</span>
          <input class="input force-ltr" type="password" bind:value={msg.aiApiKey} placeholder={secretPlaceholder(msg.aiApiKeySet)} />
        </label>
        <label class="block space-y-1">
          <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Model (optional)', ar: 'النموذج (اختياري)' }, $locale)}</span>
          <input class="input force-ltr" bind:value={msg.aiModel} placeholder="claude-opus-5" />
        </label>
      </div>

      <div class="flex items-center gap-3">
        <button class="btn-primary" type="submit" disabled={msgSaving}>{msgSaving ? $t('common.loading') : $t('common.save')}</button>
        {#if msgSaved}<span class="text-sm text-emerald-600 dark:text-emerald-400">✓</span>{/if}
      </div>
    </form>
  {/if}
{/if}
