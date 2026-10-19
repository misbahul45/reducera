import type { WatchSource } from 'vue';
import { DEFAULT_STEP, hasMoreItems, initialVisibleCount, nextVisibleCount, visibleSlice } from '~/lib/paging';

interface IncrementalOptions {
  step?: number;
  resetOn?: WatchSource;
}

export function useIncremental<T>(source: Readonly<Ref<readonly T[]>>, options: IncrementalOptions = {}) {
  const step = options.step ?? DEFAULT_STEP;
  const count = ref(initialVisibleCount(source.value.length, step));

  if (options.resetOn) {
    watch(options.resetOn, () => {
      count.value = initialVisibleCount(source.value.length, step);
    });
  }

  const visible = computed(() => visibleSlice(source.value, count.value));
  const total = computed(() => source.value.length);
  const hasMore = computed(() => hasMoreItems(visible.value.length, source.value.length));

  function more() {
    count.value = nextVisibleCount(count.value, source.value.length, step);
  }

  function reset() {
    count.value = initialVisibleCount(source.value.length, step);
  }

  function reveal(index: number) {
    if (index >= count.value) count.value = Math.min(source.value.length, index + 1);
  }

  return { visible, total, hasMore, more, reset, reveal };
}
