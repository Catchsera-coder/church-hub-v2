<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api.js';
  import { t, locale, tr, LOCALES, arabicEnabled } from '$lib/i18n.js';
  import { hasRole } from '$lib/stores/auth.js';
  import { theme, fontScale, boldText } from '$lib/stores/appearance.js';
  import { applyBrandColor } from '$lib/stores/brand.js';
  import PageHeader from '$lib/components/PageHeader.svelte';

  const SIZES = [
    { v: 0.9, label: { en: 'Small', ar: 'صغير' } },
    { v: 1, label: { en: 'Normal', ar: 'عادي' } },
    { v: 1.15, label: { en: 'Large', ar: 'كبير' } },
    { v: 1.3, label: { en: 'Extra large', ar: 'كبير جداً' } },
  ];

  // Dashboard widgets (#17). Enabled set is stored per-church, in this order.
  const DASH_WIDGETS = [
    { key: 'members', label: { en: 'Members', ar: 'الأعضاء' } },
    { key: 'families', label: { en: 'Families', ar: 'العائلات' } },
    { key: 'attendance', label: { en: 'Attendance this month', ar: 'الحضور هذا الشهر' } },
    { key: 'newMembers', label: { en: 'New this month', ar: 'جدد هذا الشهر' } },
    { key: 'awaitingApproval', label: { en: 'Awaiting approval', ar: 'بانتظار الموافقة' } },
    { key: 'birthdays', label: { en: 'Birthdays this month', ar: 'أعياد ميلاد هذا الشهر' } },
    { key: 'upcoming', label: { en: 'Upcoming gatherings', ar: 'الاجتماعات القادمة' } },
    { key: 'services', label: { en: 'Attendance by service', ar: 'الحضور حسب الخدمة' } },
    { key: 'giving', label: { en: 'Giving this month', ar: 'العطاء هذا الشهر' } },
  ];
  const ALL_WIDGET_KEYS = DASH_WIDGETS.map((w) => w.key);

  // Azure OpenAI models, named so admins understand the cost/quality trade-off.
  const AZURE_MODELS = [
    { id: 'gpt-4o-mini', name: 'GPT-4o mini — recommended (smart, low cost)', hint: 'Best value for church messages.' },
    { id: 'gpt-4.1-mini', name: 'GPT-4.1 mini (newer, low cost)', hint: 'Newer small model.' },
    { id: 'gpt-4o', name: 'GPT-4o (highest quality)', hint: 'Higher cost, top quality.' },
    { id: 'gpt-4.1', name: 'GPT-4.1 (top quality)', hint: 'Higher cost, latest full model.' },
  ];

  function toggleWidget(key: string) {
    const set = new Set(form.dashboard?.widgets ?? ALL_WIDGET_KEYS);
    if (set.has(key)) set.delete(key); else set.add(key);
    // Persist in the canonical catalog order regardless of toggle sequence.
    form.dashboard = { widgets: ALL_WIDGET_KEYS.filter((k) => set.has(k)) };
  }

  let form = $state<any>(null);
  let saving = $state(false);
  let saved = $state(false);

  // Messaging (Admin only)
  const isAdmin = hasRole('Admin') || hasRole('Super Admin');
  let msg = $state<any>(null);
  let msgSaving = $state(false);
  let msgSaved = $state(false);
  // Is email delivery actually usable? If not, password resets + email messages
  // silently won't send (that's why "Forgot password" delivered nothing).
  const emailConfigured = $derived(!!msg && (
    msg.envEmailDefault ||
    (msg.sendgridApiKeySet && msg.mailFrom) ||
    (msg.acsConnectionStringSet && msg.acsMailFrom)
  ));

  onMount(async () => {
    const r = await api<{ data: any }>('/settings');
    // Default the dashboard to all widgets when the church hasn't customized it.
    const widgets = r.data.dashboard?.widgets?.length ? r.data.dashboard.widgets : ALL_WIDGET_KEYS;
    form = { ...r.data, name: r.data.name ?? {}, dashboard: { widgets } };
    if (isAdmin) {
      const m = await api<{ data: any }>('/settings/messaging');
      // secret fields start blank; blank on save = leave unchanged
      msg = { ...m.data, sendgridApiKey: '', twilioAuthToken: '', acsConnectionString: '', aiApiKey: '', azureOpenaiKey: '' };
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
        brandColor: form.brandColor || null,
        dashboard: { widgets: form.dashboard?.widgets ?? ALL_WIDGET_KEYS },
      }) });
      saved = true;
      // Reflect the brand colour app-wide immediately.
      applyBrandColor(form.brandColor);
      // Reflect the Arabic toggle app-wide so every form/picker updates at once.
      arabicEnabled.set(!!form.arabicEnabled);
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
        whatsappFrom: msg.whatsappFrom,
        aiProvider: msg.aiProvider, aiModel: msg.aiModel, aiApiKey: msg.aiApiKey,
        azureOpenaiEndpoint: msg.azureOpenaiEndpoint, azureOpenaiDeployment: msg.azureOpenaiDeployment,
        azureOpenaiApiVersion: msg.azureOpenaiApiVersion, azureOpenaiKey: msg.azureOpenaiKey,
      }) });
      msgSaved = true;
      // refresh the "set" indicators
      const m = await api<{ data: any }>('/settings/messaging');
      msg = { ...m.data, sendgridApiKey: '', twilioAuthToken: '', acsConnectionString: '', aiApiKey: '', azureOpenaiKey: '' };
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

      <!-- Brand colour: drives buttons, links, branded templates, and exports. -->
      <div class="space-y-1">
        <span class="block text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Brand colour', ar: 'لون العلامة' }, $locale)}</span>
        <div class="flex items-center gap-3">
          <input type="color" class="h-9 w-12 cursor-pointer rounded border border-slate-300 bg-white dark:border-slate-700" value={form.brandColor || '#3b3f8c'} oninput={(e) => { form.brandColor = (e.currentTarget as HTMLInputElement).value; applyBrandColor(form.brandColor); }} />
          <input class="input force-ltr w-32" placeholder="#3b3f8c" bind:value={form.brandColor} oninput={() => applyBrandColor(form.brandColor)} />
          {#if form.brandColor}<button type="button" class="text-xs text-rose-600 hover:underline" onclick={() => { form.brandColor = null; applyBrandColor(null); }}>{tr({ en: 'Reset', ar: 'إعادة' }, $locale)}</button>{/if}
        </div>
        <p class="text-xs text-slate-400">{tr({ en: 'Changes preview instantly. Save to apply for everyone.', ar: 'تظهر المعاينة فوراً. احفظ لتطبيقها على الجميع.' }, $locale)}</p>
      </div>
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

    <div class="card space-y-3 p-6">
      <h2 class="text-lg font-semibold">{tr({ en: 'Dashboard', ar: 'لوحة المعلومات' }, $locale)}</h2>
      <p class="text-sm text-slate-500 dark:text-slate-400">{tr({ en: 'Choose which summary widgets appear on the dashboard.', ar: 'اختر البطاقات التي تظهر في لوحة المعلومات.' }, $locale)}</p>
      {#each DASH_WIDGETS as w}
        <label class="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={(form.dashboard?.widgets ?? ALL_WIDGET_KEYS).includes(w.key)} onchange={() => toggleWidget(w.key)} />
          {tr(w.label, $locale)}
        </label>
      {/each}
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

        {#if !emailConfigured}
          <div class="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
            ⚠ {tr({ en: 'Email is not configured, so password-reset codes and email messages will NOT be delivered. Add your Azure ACS connection string + sender address (or a SendGrid key + from address) below, then Save.', ar: 'البريد غير مُهيأ، لذا لن تُرسَل رموز إعادة تعيين كلمة المرور ولا رسائل البريد. أضِف سلسلة اتصال Azure ACS وعنوان المُرسِل (أو مفتاح SendGrid وعنوان المُرسِل) بالأسفل ثم احفظ.' }, $locale)}
          </div>
        {/if}
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
        <h3 class="font-semibold">✨ {tr({ en: 'AI writing assistant', ar: 'مساعد الكتابة بالذكاء الاصطناعي' }, $locale)}</h3>
        <p class="text-xs text-slate-500 dark:text-slate-400">{tr({ en: 'Powers "Write with AI" in messages and templates. Choose your provider.', ar: 'يشغّل «الكتابة بالذكاء الاصطناعي» في الرسائل والقوالب. اختر المزوّد.' }, $locale)}</p>

        <label class="block space-y-1">
          <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Provider', ar: 'المزوّد' }, $locale)}</span>
          <select class="input" bind:value={msg.aiProvider}>
            <option value="">{tr({ en: 'Auto / deploy default', ar: 'تلقائي / الافتراضي' }, $locale)}</option>
            <option value="azure">{tr({ en: 'Azure OpenAI', ar: 'Azure OpenAI' }, $locale)}</option>
            <option value="anthropic">{tr({ en: 'Anthropic (Claude)', ar: 'Anthropic (Claude)' }, $locale)}</option>
          </select>
        </label>

        {#if msg.aiProvider === 'azure'}
          <div class="grid gap-4 sm:grid-cols-2">
            <label class="block space-y-1 sm:col-span-2">
              <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Azure endpoint', ar: 'نقطة نهاية Azure' }, $locale)}</span>
              <input class="input force-ltr" bind:value={msg.azureOpenaiEndpoint} placeholder="https://your-resource.openai.azure.com" />
            </label>
            <label class="block space-y-1 sm:col-span-2">
              <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Azure API key', ar: 'مفتاح Azure' }, $locale)}</span>
              <input class="input force-ltr" type="password" bind:value={msg.azureOpenaiKey} placeholder={secretPlaceholder(msg.azureOpenaiKeySet)} />
            </label>
            <label class="block space-y-1">
              <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Model', ar: 'النموذج' }, $locale)}</span>
              <select class="input" value={msg.aiModel || 'gpt-4o-mini'} onchange={(e) => { const v = (e.currentTarget as HTMLSelectElement).value; msg.aiModel = v; if (!msg.azureOpenaiDeployment) msg.azureOpenaiDeployment = v; }}>
                {#each AZURE_MODELS as m}<option value={m.id}>{m.name}</option>{/each}
              </select>
              <span class="text-xs text-slate-400">{AZURE_MODELS.find((m) => m.id === (msg.aiModel || 'gpt-4o-mini'))?.hint ?? ''}</span>
            </label>
            <label class="block space-y-1">
              <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Deployment name', ar: 'اسم النشر' }, $locale)}</span>
              <input class="input force-ltr" bind:value={msg.azureOpenaiDeployment} placeholder={msg.aiModel || 'gpt-4o-mini'} />
              <span class="text-xs text-slate-400">{tr({ en: 'The name you gave the deployment in Azure (often the same as the model).', ar: 'الاسم الذي أعطيته للنشر في Azure (غالباً نفس النموذج).' }, $locale)}</span>
            </label>
          </div>
          <p class="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:bg-slate-800/50 dark:text-slate-300">
            {tr({ en: 'Recommended: GPT-4o mini — smart enough for church messages and the lowest cost. Pick GPT-4o / GPT-4.1 for the highest quality.', ar: 'مُوصى به: GPT-4o mini — ذكي بما يكفي لرسائل الكنيسة وأقل تكلفة. اختر GPT-4o / GPT-4.1 لأعلى جودة.' }, $locale)}
          </p>
        {:else}
          <label class="block space-y-1">
            <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Anthropic API key', ar: 'مفتاح Anthropic' }, $locale)}</span>
            <input class="input force-ltr" type="password" bind:value={msg.aiApiKey} placeholder={secretPlaceholder(msg.aiApiKeySet)} />
          </label>
          <label class="block space-y-1">
            <span class="text-sm text-slate-600 dark:text-slate-300">{tr({ en: 'Model (optional)', ar: 'النموذج (اختياري)' }, $locale)}</span>
            <input class="input force-ltr" bind:value={msg.aiModel} placeholder="claude-opus-5" />
          </label>
        {/if}
      </div>

      <div class="flex items-center gap-3">
        <button class="btn-primary" type="submit" disabled={msgSaving}>{msgSaving ? $t('common.loading') : $t('common.save')}</button>
        {#if msgSaved}<span class="text-sm text-emerald-600 dark:text-emerald-400">✓</span>{/if}
      </div>
    </form>
  {/if}
{/if}
