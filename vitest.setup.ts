// jsdom implements no layout, so these are missing. The chat widget pins its message list
// to the bottom on every render and measures the composer to auto-grow it; stub them so
// those effects can run under test.
Element.prototype.scrollTo = () => {};
