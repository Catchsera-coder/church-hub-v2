<script lang="ts">
  import { locale, tr } from '$lib/i18n.js';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import MessageTemplateForm from '$lib/components/MessageTemplateForm.svelte';
</script>

<PageHeader title={tr({ en: 'New template', ar: 'قالب جديد' }, $locale)} />
<MessageTemplateForm />
