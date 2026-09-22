// Match the eagerly generated public-image derivative, including video posters.
export const OG_THUMBNAIL_TRANSFORM = 'c_limit,h_600,w_600/fl_strip_profile/q_auto:eco/f_jpg';

export function publicOgThumbnailUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'res.cloudinary.com' || url.username || url.password) return value;
    const match = url.pathname.match(/^(\/[^/]+\/image\/upload\/)(.*)$/);
    if (!match) return value;
    const assetPath = match[2].match(/(?:^|\/)(v\d+\/.*)$/)?.[1] || match[2].replace(`${OG_THUMBNAIL_TRANSFORM}/`, '');
    url.pathname = `${match[1]}${OG_THUMBNAIL_TRANSFORM}/${assetPath}`;
    return url.href;
  } catch { return value; }
}
