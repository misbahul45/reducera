import type { WatchSource } from 'vue';
import { describeApiError } from '~/lib/api-error';
import { feedHasMore, mergePage, type PageInfo } from '~/lib/paging';

interface FeedOptions<T, R extends { page: PageInfo }> {
  key: string;
  watch: WatchSource[];
  fetchPage: (cursor: number) => Promise<R>;
  itemsOf: (response: R) => T[];
  keyOf: (item: T) => string;
}

export async function useInfiniteFeed<T, R extends { page: PageInfo }>(options: FeedOptions<T, R>) {
  const { data, status, error, refresh } = await useAsyncData(options.key, () => options.fetchPage(0), { watch: options.watch });

  const extra = ref<T[]>([]) as Ref<T[]>;
  const nextCursor = ref<number | null>(data.value?.page.nextCursor ?? null);
  const loadingMore = ref(false);
  const moreError = ref<string | null>(null);
  let generation = 0;

  watch(data, (value) => {
    generation += 1;
    extra.value = [];
    nextCursor.value = value?.page.nextCursor ?? null;
    moreError.value = null;
    loadingMore.value = false;
  });

  const items = computed(() => mergePage(data.value ? options.itemsOf(data.value) : [], extra.value, options.keyOf));
  const total = computed(() => data.value?.page.total ?? 0);
  const hasMore = computed(() => feedHasMore(nextCursor.value));

  async function loadMore() {
    if (loadingMore.value || nextCursor.value === null) return;
    const mine = generation;
    loadingMore.value = true;
    moreError.value = null;
    try {
      const response = await options.fetchPage(nextCursor.value);
      if (mine !== generation) return;
      extra.value = mergePage(extra.value, options.itemsOf(response), options.keyOf);
      nextCursor.value = response.page.nextCursor;
    } catch (failure) {
      if (mine === generation) moreError.value = describeApiError(failure);
    } finally {
      if (mine === generation) loadingMore.value = false;
    }
  }

  return { data, status, error, refresh, items, total, hasMore, loadingMore, moreError, loadMore };
}
