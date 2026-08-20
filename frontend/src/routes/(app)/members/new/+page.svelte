<script lang="ts">
  import { t, tr, locale } from '$lib/i18n.js';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import MemberForm from '$lib/components/MemberForm.svelte';
</script>

<PageHeader title={tr({ en: 'New member', ar: 'عضو جديد' }, $locale)} />
<div class="max-w-3xl"><MemberForm /></div>
