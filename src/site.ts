/**
 * 站点形象图片。路径相对站点根目录（即 `public/` 下的文件），为 null 时使用纯排版的默认样式。
 * 放入图片后在这里填写路径即可，不需要改动页面代码。
 */
export const BRAND_IMAGES: {
  /** 首页刊头右侧的立绘/主视觉，建议透明背景 PNG 或 WebP，高度 ≥ 900px。 */
  hero: string | null;
  /** 页眉左上角的头像，建议正方形，≥ 128×128。 */
  avatar: string | null;
} = {
  hero: null,
  avatar: null,
};
