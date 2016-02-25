
Parse.Cloud.define('hello', function(req, res) {
  response.success("Hello world from " + process.env.APP_NAME);
});
