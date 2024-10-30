// novels.ts
import { Data, Route, ViewType } from '@/types';
import cache from '@/utils/cache';
import { getToken } from './token';
import getNovels, { getNovelContent, parseNovelContent, PixivResponse } from './api/get-novels';
import { config } from '@/config';
import { parseDate } from '@/utils/parse-date';
import ConfigNotFoundError from '@/errors/types/config-not-found';
import pixivUtils from './utils';

import logger from '@/utils/logger';

export const route: Route = {
    path: '/user/novels/:id',
    categories: ['social-media'],
    view: ViewType.Articles,
    example: '/pixiv/user/novels/27104704',
    parameters: { id: "User id, available in user's homepage URL" },
    features: {
        requireConfig: false,
        requirePuppeteer: false,
        antiCrawler: false,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
    },
    radar: [
        {
            source: ['www.pixiv.net/users/:id/novels'],
        },
    ],
    name: 'User Novels',
    maintainers: ['DIYgod'],
    handler,
};

async function handler(ctx): Promise<Data> {
    if (!config.pixiv || !config.pixiv.refreshToken) {
        throw new ConfigNotFoundError('pixiv RSS is disabled due to the lack of <a href="https://docs.rsshub.app/deploy/config#route-specific-configurations">relevant config</a>');
    }

    const id = ctx.req.param('id');
    const token = await getToken(cache.tryGet);
    if (!token) {
        throw new ConfigNotFoundError('pixiv not login');
    }

    const response = (await getNovels(id, token)) as PixivResponse;
    logger.debug(JSON.stringify(response));
    const novels = response.data.novels;
    const username = novels[0].user.name;

    // 使用 Promise.all 並行獲取所有小說的內容
    const novelsWithContent = await Promise.all(
        novels.map(async (novel) => {
            try {
                const contentResponse = await getNovelContent(novel.id, token);
                const content = parseNovelContent(contentResponse.data);

                return {
                    ...novel,
                    fullContent: content,
                };
            } catch (error) {
                throw new Error(`Error fetching novel ${novel.id}: ${error instanceof Error ? error.message : String(error)}`);
            }
        })
    );

    const items = novelsWithContent.map((novel) => ({
        title: novel.series?.title ? `${novel.series.title} - ${novel.title}` : novel.title,
        description: `
            <div class="novel-container">
            ${novel.caption ? novel.caption : ''}
            ${pixivUtils.getNovelImgs(novel).join('')}
            <div>字數：${novel.text_length}</div>
            <div>閱覽數：${novel.total_view}</div>
            <div>收藏數：${novel.total_bookmarks}</div>
            <div>評論數：${novel.total_comments}</div>
            ${novel.fullContent}`,
        author: novel.user.name,
        pubDate: parseDate(novel.create_date),
        link: `https://www.pixiv.net/novel/show.php?id=${novel.id}`,
        category: novel.tags.map((t) => t.name),
    }));

    return {
        title: `${username} 的 pixiv 小说`,
        description: `${username} 的 pixiv 最新小说`,
        image: pixivUtils.getProxiedImageUrl(novels[0].user.profile_image_urls.medium),
        link: `https://www.pixiv.net/users/${id}/novels`,
        item: items,
    };
}
