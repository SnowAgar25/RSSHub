import { Route, Data } from '@/types';
import cache from '@/utils/cache';
import { art } from '@/utils/render';
import path from 'node:path';
import { Context } from 'hono';
import { Genre, GenreNotation, NarouNovelFetch, NovelTypeParam, Order, R18Site, SearchBuilder, SearchBuilderR18, SearchParams } from 'narou';
import queryString from 'query-string';
import { Join } from 'narou/util/type';
import InvalidParameterError from '@/errors/types/invalid-parameter';

import { getCurrentPath } from '@/utils/helpers';
const __dirname = getCurrentPath(import.meta.url);

interface NarouSearchParams {
    /**
     * 作品種別の絞り込み Work Type Filter
     *
     * t 短編 Short
     * r 連載中 Ongoing Series
     * er 完結済連載作品 Completed Series
     * re すべての連載作品 (連載中および完結済) Series and Completed Series
     * ter 短編と完結済連載作品 Completed Works (Including Short and Series)
     *
     * tr 短編と連載中小説 Short and Ongoing Series
     * all 全ての種別 (Default) All Types
     *
     * Note: While the official documentation describes 5 values, all 7 values above are functional.
     */
    type?: 't' | 'r' | 'er' | 're' | 'ter' | 'tr' | 'all';

    /** 検索ワード Search Keywords */
    word?: string;

    /** 除外ワード Excluded Keywords */
    notword?: string;

    /**
     * 検索範囲指定 Search Range Specifications
     *
     * - 読了時間 Reading Time
     * - 文字数 Character Count
     * - 総合ポイント Total Points
     * - 最新掲載日（年月日）Latest Update Date (Year/Month/Day)
     * - 初回掲載日（年月日）First Publication Date (Year/Month/Day)
     */
    mintime?: number;
    maxtime?: number;
    minlen?: number;
    maxlen?: number;
    min_globalpoint?: number;
    max_globalpoint?: number;
    minlastup?: string;
    maxlastup?: string;
    minfirstup?: string;
    maxfirstup?: string;

    /**
     * 抽出条件の指定 Extraction Conditions
     *
     * - 挿絵のある作品 Works with Illustrations
     * - 小説 PickUp！対象作品 Featured Novels
     *
     * 作品に含まれる要素：Elements Included in Works:
     * - 残酷な描写あり Contains Cruel Content
     * - ボーイズラブ Boys' Love
     * - ガールズラブ Girls' Love
     * - 異世界転生 Reincarnation in Another World
     * - 異世界転移 Transportation to Another World
     */
    sasie?: string;
    ispickup?: boolean;
    iszankoku?: boolean;
    isbl?: boolean;
    isgl?: boolean;
    istensei?: boolean;
    istenni?: boolean;

    /**
     * 除外条件の指定 Exclusion Conditions
     *
     * - 長期連載停止中の作品 Works on Long-term Hiatus
     *
     * 作品に含まれる要素：Elements to Exclude:
     * - 残酷な描写あり Cruel Content
     * - ボーイズラブ Boys' Love
     * - ガールズラブ Girls' Love
     * - 異世界転生 Reincarnation in Another World
     * - 異世界転移 Transportation to Another World
     */
    stop?: boolean;
    notzankoku?: boolean;
    notbl?: boolean;
    notgl?: boolean;
    nottensei?: boolean;
    nottenni?: boolean;

    /**
     * ワード検索範囲指定 Word Search Scope
     * すべてのチェックを解除した場合、すべての項目がワード検索の対象となります。
     * If all boxes are unchecked, all items will become targets for word search.
     *
     * 作品タイトル Work Title
     * あらすじ Synopsis
     * キーワード Keywords
     * 作者名 Author Name
     */
    title?: boolean;
    ex?: boolean;
    keyword?: boolean;
    wname?: boolean;

    /**
     * 並び順 Sort Order
     * - new: 新着更新順 (Default) Latest Updates
     * - weekly: 週間ユニークアクセスが多い順 Most Weekly Unique Access
     * - favnovelcnt: ブックマーク登録の多い順 Most Bookmarks
     * - reviewcnt: レビューの多い順 Most Reviews
     * - hyoka: 総合ポイントの高い順 Highest Total Points
     * - dailypoint: 日間ポイントの高い順 Highest Daily Points
     * - weeklypoint: 週間ポイントの高い順 Highest Weekly Points
     * - monthlypoint: 月間ポイントの高い順 Highest Monthly Points
     * - quarterpoint: 四半期ポイントの高い順 Highest Quarterly Points
     * - yearlypoint: 年間ポイントの高い順 Highest Yearly Points
     * - hyokacnt: 評価者数の多い順 Most Ratings
     * - lengthdesc: 文字数の多い順 Most Characters
     * - generalfirstup: 初回掲載順 First Publication Order
     * - ncodedesc: N コード降順 Ncode Descending
     * - old: 更新が古い順 Oldest Updates
     */
    order?: 'new' | 'weekly' | 'favnovelcnt' | 'reviewcnt' | 'hyoka' | 'dailypoint' | 'weeklypoint' | 'monthlypoint' | 'quarterpoint' | 'yearlypoint' | 'hyokacnt' | 'lengthdesc' | 'generalfirstup' | 'ncodedesc' | 'old';

    /** ジャンル Genre */
    genre?: string;

    /** 掲載サイト指定 Site */
    nocgenre?: number;
}

export const route: Route = {
    path: '/search/:sub/:query',
    categories: ['reading'],
    example: '/syosetu/search/noc/word=ハーレム&notword=&type=r&mintime=&maxtime=&minlen=30000&maxlen=&min_globalpoint=&max_globalpoint=&minlastup=&maxlastup=&minfirstup=&maxfirstup=&isgl=1&notbl=1&order=new',
    parameters: {
        sub: 'The target Syosetu subsite (yomou/noc/mnlt/mid).',
        query: 'Search parameters in Syosetu format.',
    },
    features: {
        requireConfig: false,
        requirePuppeteer: false,
        antiCrawler: false,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
    },
    name: 'Search',
    maintainers: ['SnowAgar25'],
    handler,
};

const setIfExists = (value) => value ?? undefined;

/**
 * This function converts query string generated by Syosetu website into API-compatible format.
 * It is not intended for users to freely adjust values.
 *
 * @see https://deflis.github.io/node-narou/index.html
 * @see https://dev.syosetu.com/man/api/
 */
function mapToSearchParams(query: string): SearchParams {
    const params = queryString.parse(query) as NarouSearchParams;

    const searchParams: SearchParams = {
        gzip: 5,
        lim: 40,
    };

    searchParams.word = setIfExists(params.word);
    searchParams.notword = setIfExists(params.notword);

    searchParams.title = setIfExists(params.title);
    searchParams.ex = setIfExists(params.ex);
    searchParams.keyword = setIfExists(params.keyword);
    searchParams.wname = setIfExists(params.wname);

    searchParams.sasie = setIfExists(params.sasie);
    searchParams.iszankoku = setIfExists(params.iszankoku);
    searchParams.isbl = setIfExists(params.isbl);
    searchParams.isgl = setIfExists(params.isgl);
    searchParams.istensei = setIfExists(params.istensei);
    searchParams.istenni = setIfExists(params.istenni);

    searchParams.stop = setIfExists(params.stop);
    searchParams.notzankoku = setIfExists(params.notzankoku);
    searchParams.notbl = setIfExists(params.notbl);
    searchParams.notgl = setIfExists(params.notgl);
    searchParams.nottensei = setIfExists(params.nottensei);
    searchParams.nottenni = setIfExists(params.nottenni);

    searchParams.minlen = setIfExists(params.minlen);
    searchParams.maxlen = setIfExists(params.maxlen);

    searchParams.type = setIfExists(params.type as NovelTypeParam);
    searchParams.order = setIfExists(params.order as Order);
    searchParams.genre = setIfExists(params.genre as Join<Genre> | Genre);
    searchParams.nocgenre = setIfExists(params.nocgenre as Join<R18Site> | R18Site);

    if (params.mintime || params.maxtime) {
        searchParams.time = `${params.mintime || ''}-${params.maxtime || ''}`;
    }

    return searchParams;
}

enum SyosetuSub {
    NORMAL = 'yomou',
    NOCTURNE = 'noc',
    MOONLIGHT = 'mnlt',
    MIDNIGHT = 'mid',
}

const isGeneral = (sub: string): boolean => sub === SyosetuSub.NORMAL;

function createNovelSearchBuilder(sub: string, searchParams: SearchParams) {
    if (isGeneral(sub)) {
        return new SearchBuilder(searchParams, new NarouNovelFetch());
    }

    const r18Params = { ...searchParams };

    switch (sub) {
        case SyosetuSub.NOCTURNE:
            r18Params.nocgenre = R18Site.Nocturne;
            break;
        case SyosetuSub.MOONLIGHT:
            // If either 女性向け/BL is chosen, nocgenre will be in query string
            // If no specific genre selected, include both
            if (!r18Params.nocgenre) {
                r18Params.nocgenre = [R18Site.MoonLight, R18Site.MoonLightBL].join('-') as Join<R18Site>;
            }
            break;
        case SyosetuSub.MIDNIGHT:
            r18Params.nocgenre = R18Site.Midnight;
            break;
        default:
            throw new InvalidParameterError('Invalid Syosetu subsite.\nValid subsites are: yomou, noc, mnlt, mid');
    }

    return new SearchBuilderR18(r18Params, new NarouNovelFetch());
}

async function handler(ctx: Context): Promise<Data> {
    const { sub, query } = ctx.req.param();
    const searchUrl = `https://${sub}.syosetu.com/search/search/search.php?${query}`;

    return (await cache.tryGet(searchUrl, async () => {
        const searchParams = mapToSearchParams(query);
        const builder = createNovelSearchBuilder(sub, searchParams);
        const result = await builder.execute();

        const items = result.values.map((novel) => ({
            title: novel.title,
            link: `https://${isGeneral(sub) ? 'ncode' : 'novel18'}.syosetu.com/${String(novel.ncode).toLowerCase()}`,
            description: art(path.join(__dirname, 'templates', 'description.art'), {
                novel,
                genreText: GenreNotation[novel.genre],
            }),
            // Skip pubDate - search results prioritize search sequence over timestamps
            // pubDate: novel.general_lastup,
            author: novel.writer,
            // Split by slash(/), full-width slash(／) and whitespace characters(\s)
            category: novel.keyword.split(/[/\uFF0F\s]/).filter(Boolean),
        }));

        const searchTerms: string[] = [];
        if (searchParams.word) {
            searchTerms.push(searchParams.word);
        }
        if (searchParams.notword) {
            searchTerms.push(`-${searchParams.notword}`);
        }

        return {
            title: searchTerms.length > 0 ? `Syosetu Search: ${searchTerms.join(' ')}` : 'Syosetu Search',
            link: searchUrl,
            item: items,
        };
    })) as Data;
}
