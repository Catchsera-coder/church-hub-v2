import { derived, writable } from 'svelte/store';

export type Locale = 'en' | 'ar';
export const LOCALES: { code: Locale; native: string; dir: 'ltr' | 'rtl' }[] = [
  { code: 'en', native: 'English', dir: 'ltr' },
  { code: 'ar', native: 'العربية', dir: 'rtl' },
];

// Message catalogs. Every user-facing string lives here — never hardcoded in a
// component (v1 lesson: renaming a tab must be a one-file change).
const messages: Record<Locale, Record<string, string>> = {
  en: {
    'app.name': 'Church Hub',
    'nav.dashboard': 'Dashboard',
    'nav.members': 'Members',
    'nav.families': 'Families',
    'nav.ministries': 'Ministries',
    'nav.attendance': 'Gatherings',
    'nav.checkin': 'Check-in',
    'nav.forms': 'Forms',
    'nav.contributions': 'Contributions',
    'nav.counting': 'Counting sessions',
    'nav.funds': 'Funds',
    'nav.sermons': 'Sermons',
    'nav.events': 'Events',
    'nav.messages': 'Messages',
    'nav.team': 'Team',
    'nav.activity': 'Activity log',
    'nav.settings': 'Church details',
    'group.congregation': 'Congregation',
    'group.gatherings': 'Attendance',
    'group.giving': 'Giving',
    'group.teaching': 'Teaching & Events',
    'group.communication': 'Communication',
    'group.admin': 'Administration',
    'auth.signin': 'Sign in',
    'auth.email': 'Email',
    'auth.password': 'Password',
    'auth.signing_in': 'Signing in…',
    'auth.invalid': 'Invalid email or password.',
    'auth.signout': 'Sign out',
    'auth.forgot': 'Forgot password?',
    'auth.forgot_prompt': 'Enter your account email and we will send a 6-digit reset code.',
    'auth.forgot_send': 'Send code',
    'auth.forgot_sent': 'If that email has an account, a code is on its way. Enter it below.',
    'auth.code': 'Reset code',
    'auth.reset_title': 'Reset password',
    'auth.new_password': 'New password',
    'auth.confirm_password': 'Confirm password',
    'auth.reset_submit': 'Set new password',
    'auth.reset_done': 'Password updated. Redirecting to sign in…',
    'auth.back_to_signin': 'Back to sign in',
    'common.new': 'New',
    'common.search': 'Search…',
    'common.save': 'Save',
    'common.delete': 'Delete',
    'common.cancel': 'Cancel',
    'common.loading': 'Loading…',
    'common.none': 'Nothing here yet.',
    'stat.members': 'Members',
    'stat.families': 'Families',
    'stat.attendance': 'Attendance this month',
    'stat.giving': 'Giving this month',
    'members.empty': 'No members yet — add your first to build the directory.',
  },
  ar: {
    'app.name': 'مركز الكنيسة',
    'nav.dashboard': 'لوحة المعلومات',
    'nav.members': 'الأعضاء',
    'nav.families': 'العائلات',
    'nav.ministries': 'الخدمات',
    'nav.attendance': 'الاجتماعات',
    'nav.checkin': 'تسجيل الحضور',
    'nav.forms': 'النماذج',
    'nav.contributions': 'العطايا',
    'nav.counting': 'جلسات العدّ',
    'nav.funds': 'الصناديق',
    'nav.sermons': 'العظات',
    'nav.events': 'الفعاليات',
    'nav.messages': 'الرسائل',
    'nav.team': 'الفريق',
    'nav.activity': 'سجل النشاط',
    'nav.settings': 'بيانات الكنيسة',
    'group.congregation': 'الجماعة',
    'group.gatherings': 'الحضور',
    'group.giving': 'العطاء',
    'group.teaching': 'التعليم والفعاليات',
    'group.communication': 'التواصل',
    'group.admin': 'الإدارة',
    'auth.signin': 'تسجيل الدخول',
    'auth.email': 'البريد الإلكتروني',
    'auth.password': 'كلمة المرور',
    'auth.signing_in': 'جارٍ الدخول…',
    'auth.invalid': 'بريد إلكتروني أو كلمة مرور غير صحيحة.',
    'auth.signout': 'تسجيل الخروج',
    'auth.forgot': 'نسيت كلمة المرور؟',
    'auth.forgot_prompt': 'أدخل بريد حسابك وسنرسل رمزاً من 6 أرقام لإعادة التعيين.',
    'auth.forgot_send': 'إرسال الرمز',
    'auth.forgot_sent': 'إن كان لهذا البريد حساب، فالرمز في طريقه إليك. أدخله بالأسفل.',
    'auth.code': 'رمز إعادة التعيين',
    'auth.reset_title': 'إعادة تعيين كلمة المرور',
    'auth.new_password': 'كلمة مرور جديدة',
    'auth.confirm_password': 'تأكيد كلمة المرور',
    'auth.reset_submit': 'تعيين كلمة المرور',
    'auth.reset_done': 'تم تحديث كلمة المرور. جارٍ التحويل لتسجيل الدخول…',
    'auth.back_to_signin': 'العودة لتسجيل الدخول',
    'common.new': 'جديد',
    'common.search': 'بحث…',
    'common.save': 'حفظ',
    'common.delete': 'حذف',
    'common.cancel': 'إلغاء',
    'common.loading': 'جارٍ التحميل…',
    'common.none': 'لا يوجد شيء بعد.',
    'stat.members': 'الأعضاء',
    'stat.families': 'العائلات',
    'stat.attendance': 'الحضور هذا الشهر',
    'stat.giving': 'العطاء هذا الشهر',
    'members.empty': 'لا يوجد أعضاء بعد — أضِف أول عضو لبناء الدليل.',
  },
};

const stored = (typeof localStorage !== 'undefined' && (localStorage.getItem('locale') as Locale)) || 'en';
export const locale = writable<Locale>(stored);

locale.subscribe((l) => {
  if (typeof document !== 'undefined') {
    const dir = LOCALES.find((x) => x.code === l)?.dir ?? 'ltr';
    document.documentElement.lang = l;
    document.documentElement.dir = dir;
    localStorage.setItem('locale', l);
  }
});

/** Whether this church has Arabic enabled (set from org settings at app load,
 *  and updated live when the Settings toggle is saved). Drives whether Arabic
 *  appears ANYWHERE in the UI. Defaults to false so Arabic stays hidden until
 *  we've confirmed it's enabled. */
export const arabicEnabled = writable(false);

/** The locales to actually render in the UI: English always; Arabic only when
 *  the church enabled it. Use this instead of LOCALES for per-language fields
 *  and language pickers so Arabic never shows when it's off. */
export const enabledLocales = derived(arabicEnabled, ($ar) => LOCALES.filter((l) => l.code === 'en' || $ar));

/** Reactive translator: `$t('nav.members')`. Falls back to the key. */
export const t = derived(locale, ($l) => (key: string) => messages[$l][key] ?? messages.en[key] ?? key);

/** Pick a locale value from a translatable JSONB field. */
export function tr(value: Record<string, string> | null | undefined, l: Locale): string {
  if (!value) return '';
  return value[l] || value.en || Object.values(value)[0] || '';
}

// Format a person's name in the chosen order. Both parts are always kept; only
// the display order changes (a per-device preference).
export function displayName(
  p: { givenName?: Record<string, string> | null; familyName?: Record<string, string> | null },
  order: 'given-first' | 'family-first',
  l: Locale,
): string {
  const given = tr(p.givenName, l);
  const family = tr(p.familyName, l);
  return (order === 'family-first' ? `${family} ${given}` : `${given} ${family}`).trim();
}
