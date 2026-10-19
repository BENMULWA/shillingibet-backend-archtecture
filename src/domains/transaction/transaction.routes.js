'use strict';

const { Router } = require("express");
const controller = require("./transaction.controller");
const schemas = require("./transaction.validation");
const validate = require("../../middlewares/validate");
const { authenticate } = require("../../middlewares/auth");
const { depositLimiter, withdrawalLimiter } = require("../../middlewares/rateLimiter");
const config = require("../../config");
const ApiError = require("../../utils/ApiError");

const router = Router();

const verifyCallbackSecret = (req, _res, next) => {
  const expected = config.mamlaka.callbackSecret;
  if (!expected) return next();
  if (req.query.secret === expected) return next();
  return next(ApiError.unauthorized("Invalid callback secret"));
};

router.post("/callback/:type", verifyCallbackSecret, controller.callback);

router.use(authenticate);
router.post(
  "/deposit",
  depositLimiter,
  validate({ body: schemas.deposit }),
  controller.deposit,
);
router.post(
  "/withdraw",
  withdrawalLimiter,
  validate({ body: schemas.withdraw }),
  controller.withdraw,
);
router.get("/", validate({ query: schemas.list }), controller.list);
router.get("/:id", controller.getById);

module.exports = router;
