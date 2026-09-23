# Made-to-order catalog products

Batch 85 / source report 38 Chef portion. `CreateProductDto` and `UpdateProductDto` accept an optional boolean `madeToOrder`. The service stores it in `Product.attributes.madeToOrder`, preserving other attributes on partial edits. Attribute-only writes cannot change the supply mode independently of inventory normalization.

For made-to-order products, product and every variant stock are null. Existing cart/sale code treats that as untracked inventory; usual cart quantity caps, product visibility, shop status, launch and variant requirements still apply. Confirmation of preparation time/capacity belongs to the shop's acceptance flow. Returning to stocked mode requires an explicit stock count; null or omission is rejected, zero means sold out. Active option stocks remain untracked until specifically supplied, falling back to product stock.

Discovery includes the derived boolean and listing readiness recognizes this availability mode. No schema change or migration is required. Focused service/cart regression checks and the full 317-test suite pass, along with the production build and final TypeScript check. No database or external provider was used for acceptance.
