<script lang="ts">
  import * as QRCode from 'qrcode';
  import { locale, tr } from '$lib/i18n.js';

  // The member's personal check-in QR. Encodes their qrToken, which the kiosk
  // "Scan a member card" box reads to check them in. Printable as a wallet card.
  let { qrToken, name }: { qrToken: string; name: string } = $props();
  let url = $state('');

  $effect(() => {
    if (!qrToken) { url = ''; return; }
    QRCode.toDataURL(qrToken, { width: 240, margin: 1 }).then((d) => (url = d)).catch(() => (url = ''));
  });

  function printCard() {
    const w = window.open('', '_blank', 'width=420,height=600');
    if (!w) return;
    const safe = name.replace(/</g, '&lt;');
    w.document.write(
      `<!doctype html><html><head><meta charset="utf-8"><title>${safe}</title></head>` +
      `<body style="font-family:system-ui,sans-serif;text-align:center;padding:32px;margin:0">` +
      `<div style="border:1px solid #ddd;border-radius:16px;padding:24px;max-width:280px;margin:0 auto">` +
      `<h2 style="margin:0 0 12px">${safe}</h2>` +
      `<img src="${url}" alt="QR" style="width:240px;height:240px"/>` +
      `<p style="color:#666;font-size:12px;margin-top:8px">Check-in card — scan at the kiosk</p>` +
      `</div></body></html>`,
    );
    w.document.close();
    w.focus();
    w.print();
  }
</script>

<div class="card max-w-xs p-6 text-center">
  <h3 class="mb-1 font-semibold">{tr({ en: 'Check-in card', ar: 'بطاقة الحضور' }, $locale)}</h3>
  <p class="mb-3 text-xs text-slate-500 dark:text-slate-400">{tr({ en: "This member's personal QR — scan it at the kiosk to check them in.", ar: 'رمز العضو الشخصي — امسحه في الجهاز لتسجيل حضوره.' }, $locale)}</p>
  {#if url}
    <img src={url} alt="Member QR" class="mx-auto w-40 rounded-lg bg-white p-2" />
    <button class="btn-ghost mt-3" onclick={printCard}>🖨 {tr({ en: 'Print card', ar: 'طباعة البطاقة' }, $locale)}</button>
  {/if}
</div>
