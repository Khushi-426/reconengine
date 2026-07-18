import { AppError } from "../utils/AppError.js";

/**
 * Usage: router.post('/x', validate({ body: someZodSchema }), controller)
 * Validates and REPLACES req.body/query/params with the parsed (and coerced) result,
 * so downstream code can trust the shape/types.
 */
export function validate(schemas) {
  return (req, res, next) => {
    try {
      if (schemas.body) req.body = schemas.body.parse(req.body);
      if (schemas.query) req.query = schemas.query.parse(req.query);
      if (schemas.params) req.params = schemas.params.parse(req.params);
      next();
    } catch (err) {
      const details = err.errors?.map((e) => ({ path: e.path.join("."), message: e.message }));
      next(new AppError(422, "Validation failed", "VALIDATION_ERROR", details));
    }
  };
}
