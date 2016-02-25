
Parse.Cloud.define('hello', function(req, res) {
  res.success("Hello world from " + process.env.APP_NAME);
});
