function addTrailingSlash(s) {
  if (s.length > 0 && s.substr(-1) != "/") {
    return s + "/";
  }
  return s;
}

exports.addTrailingSlash = addTrailingSlash;
