module.exports = function (api) {
  // La configurazione dipende dall'ambiente: la cache deve seguirlo.
  api.cache.using(() => process.env.BABEL_ENV || process.env.NODE_ENV);
  const prod = (process.env.BABEL_ENV || process.env.NODE_ENV) === "production";
  const plugins = [];
  // Nella build pubblicata i console.log spariscono: su Hermes ognuno costa, e nei cicli
  // di aggiornamento erano centinaia al secondo. Il plugin dei worklets resta per ultimo.
  if (prod) plugins.push("transform-remove-console");
  plugins.push("react-native-worklets/plugin");
  return { presets: ["babel-preset-expo"], plugins };
};
