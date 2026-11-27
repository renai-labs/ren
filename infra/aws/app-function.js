var site = ["/delete-account", "/demo", "/docs", "/pricing", "/privacy", "/raw", "/terms", "/why"]
var hint = "ren_signed_in"

function query(querystring) {
  var pairs = []
  Object.keys(querystring).forEach(function (key) {
    var each = querystring[key].multiValue || [querystring[key]]
    each.forEach(function (item) {
      pairs.push(item.value === "" ? key : key + "=" + item.value)
    })
  })
  return pairs.length === 0 ? "" : "?" + pairs.join("&")
}

// oxlint-disable-next-line ren/no-comments -- CloudFront Functions run plain JavaScript, so JSDoc is the only way to type the event
/** @param {{ request: { uri: string, querystring: Record<string, { value: string, multiValue?: Array<{ value: string }> }>, cookies: Record<string, { value: string } | undefined> } }} event */
function handler(event) {
  var request = event.request
  var uri = request.uri
  var file = uri.split("/").pop().indexOf(".") !== -1
  if (uri === "/app" || (uri.startsWith("/app/") && !file)) {
    var cookies = {}
    cookies[hint] = { value: "1", attributes: "Path=/; Max-Age=7776000; Secure; SameSite=Lax" }
    return {
      statusCode: 302,
      statusDescription: "Found",
      headers: { location: { value: (uri.slice(4) || "/") + query(request.querystring) } },
      cookies: cookies,
    }
  }
  if (uri === "/install") {
    request.uri = "/ren/install.sh"
    return request
  }
  if (uri === "/onboard") {
    request.uri = "/onboard.md"
    return request
  }
  if (uri.startsWith("/ren/") || file) {
    return request
  }
  if (uri === "/") {
    request.uri = request.cookies[hint] ? "/app/index.html" : "/index.html"
  } else if (uri === "/home" || uri === "/home/") {
    request.uri = "/index.html"
  } else if (
    site.some(function (path) {
      return uri === path || uri.startsWith(path + "/")
    })
  ) {
    request.uri = uri.endsWith("/") ? uri + "index.html" : uri + "/index.html"
  } else {
    request.uri = "/app/index.html"
  }
  return request
}
