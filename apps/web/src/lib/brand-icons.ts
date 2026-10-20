import {
  siApple,
  siBigbasket,
  siBookmyshow,
  siGoogle,
  siNetflix,
  siPaytm,
  siPlaystation,
  siSpotify,
  siSwiggy,
  siUber,
  siYoutube,
  siZomato,
} from 'simple-icons';

/**
 * Brand glyphs (simple-icons, CC0) for the platforms that have one. Everything else falls back to a
 * monogram on the brand colour. Marks are used only to identify a merchant, never to imply endorsement.
 */
export const BRAND_PATHS: Record<string, string> = {
  apple: siApple.path,
  bigbasket: siBigbasket.path,
  bookmyshow: siBookmyshow.path,
  google: siGoogle.path,
  netflix: siNetflix.path,
  paytm: siPaytm.path,
  playstation: siPlaystation.path,
  spotify: siSpotify.path,
  swiggy: siSwiggy.path,
  uber: siUber.path,
  youtube: siYoutube.path,
  zomato: siZomato.path,
};
