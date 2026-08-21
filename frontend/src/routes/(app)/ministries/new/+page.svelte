<script lang="ts">
  import { tr, locale } from '$lib/i18n.js';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import MinistryForm from '$lib/components/MinistryForm.svelte';
</script>

<PageHeader title={tr({ en: 'New ministry or group', ar: 'خدمة أو مجموعة جديدة' }, $locale)} back="/ministries" />
<div class="max-w-3xl"><MinistryForm /></div>
