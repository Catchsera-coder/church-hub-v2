<script lang="ts">
  import { AsYouType, parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';
  import { tr, locale } from '$lib/i18n.js';

  // One phone field for the whole app. It formats the number AS YOU TYPE (e.g.
  // (617) 555-1234), shows a ✓ when it's a real number, warns gently when it isn't,
  // and stores it in the clean international form (+16175551234) so SMS/WhatsApp
  // always work. Default country is the US; for anywhere else, start with "+" and
  // the country code and it formats that country automatically.
  let {
    value = $bindable(''),
    country = 'US' as CountryCode,
    required = false,
    placeholder = '',
    id = undefined,
  }: { value?: string | null; country?: CountryCode; required?: boolean; placeholder?: string; id?: string } = $props();

  let el = $state<HTMLInputElement | null>(null);
  let display = $state('');
  let touched = $state(false);

  // Pretty, readable form of a stored value — national for the home country,
  // international (with +code) for anywhere else.
  function fmt(v: string | null | undefined): string {
    if (!v) return '';
    const p = parsePhoneNumberFromString(v, country);
    if (p) return p.country === country ? p.formatNational() : p.formatInternational();
    return new AsYouType((v.trim().startsWith('+') ? undefined : country) as CountryCode | undefined).input(v);
  }

  // Keep what's shown in sync with the stored value when it changes from OUTSIDE
  // (initial load, form reset) — never while the user is actively typing.
  $effect(() => {
    const v = value ?? '';
    if (!el || document.activeElement !== el) display = fmt(v);
  });

  const parsed = $derived(parsePhoneNumberFromString((display || value || '').trim(), country));
  const valid = $derived(!!parsed?.isValid());
  const hasDigits = $derived(/\d/.test(display || value || ''));

  function onInput(e: Event) {
    const raw = (e.target as HTMLInputElement).value;
    const intl = raw.trim().startsWith('+');
    display = new AsYouType((intl ? undefined : country) as CountryCode | undefined).input(raw);
    const p = parsePhoneNumberFromString(raw, country);
    // Store E.164 once it's a valid number; keep the cleaned digits meanwhile so a
    // half-typed number is never lost.
    value = p?.isValid() ? p.number : raw.replace(/[^\d+]/g, '');
  }
  function onBlur() { touched = true; display = fmt(value); }
</script>

<div>
  <div class="relative">
    <input
      bind:this={el}
      {id}
      type="tel"
      inputmode="tel"
      autocomplete="tel"
      class="input force-ltr pe-8"
      {required}
      placeholder={placeholder || '(617) 555-1234'}
      value={display}
      oninput={onInput}
      onblur={onBlur}
    />
    {#if hasDigits}
      <span class="pointer-events-none absolute inset-y-0 end-2 flex items-center text-sm {valid ? 'text-emerald-500' : 'text-amber-500'}">{valid ? '✓' : '…'}</span>
    {/if}
  </div>
  {#if touched && hasDigits && !valid}
    <p class="mt-1 text-xs text-amber-600 dark:text-amber-400">{tr({ en: 'This number looks incomplete. For another country, start with + and the country code.', ar: 'يبدو هذا الرقم غير مكتمل. لرقم دولة أخرى، ابدأ بـ + ثم رمز الدولة.' }, $locale)}</p>
  {/if}
</div>
