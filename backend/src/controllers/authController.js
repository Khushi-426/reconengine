import * as authService from "../services/authService.js";

export async function loginHandler(req, res, next) {
  try {
    const { email, password } = req.body;
    const result = await authService.login(email, password);
    // refresh token as httpOnly cookie — never exposed to JS (XSS mitigation)
    res.cookie("refreshToken", result.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    res.json({ accessToken: result.accessToken, user: result.user });
  } catch (err) {
    next(err);
  }
}

export async function refreshHandler(req, res, next) {
  try {
    const token = req.cookies?.refreshToken;
    if (!token) return res.status(401).json({ error: { message: "No refresh token provided" } });
    const result = await authService.refresh(token);
    res.cookie("refreshToken", result.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    res.json({ accessToken: result.accessToken });
  } catch (err) {
    next(err);
  }
}

export async function logoutHandler(req, res, next) {
  try {
    const token = req.cookies?.refreshToken;
    if (token) await authService.logout(token);
    res.clearCookie("refreshToken");
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
