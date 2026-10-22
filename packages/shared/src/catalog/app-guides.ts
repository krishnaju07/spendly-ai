import type { AppGuide } from './app-guide';
import { GUIDE_BIGBASKET } from './guides/bigbasket';
import { GUIDE_BLINKIT } from './guides/blinkit';
import { GUIDE_BOOKMYSHOW } from './guides/bookmyshow';
import { GUIDE_DISTRICT } from './guides/district';
import { GUIDE_JIOHOTSTAR } from './guides/jiohotstar';
import { GUIDE_NETFLIX } from './guides/netflix';
import { GUIDE_PAYTM_INSIDER } from './guides/paytm-insider';
import { GUIDE_PRIME_VIDEO } from './guides/prime-video';
import { GUIDE_SPOTIFY } from './guides/spotify';
import { GUIDE_SWIGGY_INSTAMART } from './guides/swiggy-instamart';
import { GUIDE_YOUTUBE_PREMIUM } from './guides/youtube-premium';
import { GUIDE_ZOMATO } from './guides/zomato';

/**
 * The tracked apps that cannot be linked with a sign-in of their own (Swiggy and Zepto can): how to bring each one's real
 * spending in. Order is how the list reads, food first.
 */
export const APP_GUIDES: readonly AppGuide[] = [
  GUIDE_ZOMATO,
  GUIDE_SWIGGY_INSTAMART,
  GUIDE_BLINKIT,
  GUIDE_BIGBASKET,
  GUIDE_BOOKMYSHOW,
  GUIDE_DISTRICT,
  GUIDE_PAYTM_INSIDER,
  GUIDE_NETFLIX,
  GUIDE_SPOTIFY,
  GUIDE_YOUTUBE_PREMIUM,
  GUIDE_PRIME_VIDEO,
  GUIDE_JIOHOTSTAR,
];
