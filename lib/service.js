'use strict';

var nodeUtil = require("util"),
    restify = require('restify'),
    _ = require('underscore'),
    SvcResponse = require('./svcresponse'),
    SvcContext = require("./svccontext"),
    PFParser = require("pdf2json"),
    path= require('path'),
    fs = require('fs'),
    glob = require('glob');


var PDFFORMService = (function () {
    // private static
    var _nextId = 1;
    var _name = 'PDFFORMServer';
    var _pdfPathBase = "/kits/data/mo/repo";

    // constructor
    var cls = function () {
        // private, only accessible within this constructor
        var _id = _nextId++;
		var _version = "0.0.1";

        // public (every instance will have their own copy of these methods, needs to be lightweight)
        this.get_id = function() { return _id; };
        this.get_name = function() { return _name + _id; };
        this.get_version = function() {return _version; };
    };

    // public static
    cls.get_nextId = function () {
        return _name + _nextId;
    };

    //private
    var _onPFBinDataReady = function(context,evtData) {
	nodeUtil.log(this.get_name() + " completed response.");
        var resData = new SvcResponse(200, "OK", evtData.pdfFilePath, "FormImage JSON");
        resData.formImage = evtData.formImage;
    	debugger
    	context.completeResponse(resData);
        context.destroy();
        evtData = null;
    };

    var _onPFBinDataError = function(context,evtData){
        nodeUtil.log(this.get_name() + " 500 Error: " +  JSON.stringify(evtData.data));
        context.completeResponse(new SvcResponse(500, JSON.stringify(evtData.data)));

        context.destroy();
        evtData = null;
    };

    var _customizeHeaders = function(res) {
        // Resitify currently has a bug which doesn't allow you to set default headers
        // This headers comply with CORS and allow us to server our response to any origin
        res.header("Access-Control-Allow-Origin", "*");
        res.header("Access-Control-Allow-Headers", "X-Requested-With");
        res.header("Cache-Control", "no-cache, must-revalidate");
    };

    // public (every instance will share the same method, but has no access to private fields defined in constructor)
    cls.prototype.start = function () {
        var self = this;

        //private function within this public method

        var _gfilter = function(svcContext) {
            var req = svcContext.req;
            var file_name = req.params.file_name;
            //var pdfId = req.params.pdfId;
            nodeUtil.log(self.get_name() + " received request:" + req.method + ":" + file_name );

            _parse_and_serve(path.join(_pdfPathBase , file_name), svcContext);
        };
        var _parse_and_serve = function(path, ctx) {
            var pdfParser = new PFParser(ctx);
            _customizeHeaders(ctx.res);
            pdfParser.on("pdfParser_dataReady", _.bind(_onPFBinDataReady, self, ctx));
            pdfParser.on("pdfParser_dataError", _.bind(_onPFBinDataError, self, ctx));
            pdfParser.loadPDF(path);
        };
        var _find_ranged_file = function(ctx) {
            var req = ctx.req,
                part = req.params.part,
                year = req.params.year,
                issue =req.params.issue,
                issue_int= parseInt(req.params.issue),
                dir = path.join(_pdfPathBase , "mof"+part, year),
                re = /.*\/mof[0-7]_[0-9]{4}_([0-9]+)([_-][0-9]+)?\.(pdf|json)$/
                ;
            var mg = new glob(path.join(_pdfPathBase , "mof"+part, year,  "mof"+part+ "_" + year + "*.pdf"), {},function(err,files){
                if (err) {
                    nodeUtil.log("Error searching for files:" +path.join(_pdfPathBase , "mof"+part, "*") , err);
                }else{
                    var ret= _.filter(files, function(file_name){
                        var match= re.exec(file_name),
                            from=null,
                            to=null;
                        if(match) {
                            if(match[1]){
                                from = parseInt(match[1]);
                            }
                            if(match[2]){
                                to= parseInt(match[2]);
                            }
                            if (_.isNumber(to ) && (from <= issue_int && issue_int <=to) || from == issue_int ) {
                                debugger
                                var resData = new SvcResponse(200)
                                resData.file_name=path.relative(_pdfPathBase,file_name)
                                ctx.completeResponse(resData);
                                mg.abort(); // We only ever return one file
                                return true
                            }
                        }
                    });
                    if (ret.length ==0){
                        ctx.completeResponse(new SvcResponse(404, JSON.stringify("No file found for " + JSON.stringify({year: year, part: part, issue: issue}))));
                    }
                    //ctx.completeResponse(new SvcResponse(500, JSON.stringify(matches)));
                }
            })
        }
        var _find = function(ctx) {
            var req = ctx.req;
            var part = req.params.part;
            var year = req.params.year;
            var issue =req.params.issue;
            var file = null;
            var file_name = path.join(_pdfPathBase , "mof"+part, year, "mof"+part +"_"+year+ "_"+issue);
            if (fs.exists( file_name+".pdf" )) {
                nodeUtil.log(self.get_name() + " serving json for: " + file_name+".pdf");
                _parse_and_serve(file_name+".pdf", ctx)
            }
            else if(file= _find_ranged_file(ctx)){
                nodeUtil.log(self.get_name() + " serving json for: " + file_name+".pdf");
                _parse_and_serve(file_name+".pdf", ctx)

            } else if(fs.exists( file_name+".json")){
                nodeUtil.log(self.get_name() + " serving json directly from file: " + file_name+".json");
                _customizeHeaders(ctx.res);
                debugger
            }
            debugger

        };

        var server = restify.createServer({
            name: self.get_name(),
            version: self.get_version()
        });

        server.use(restify.acceptParser(server.acceptable));
        server.use(restify.authorizationParser());
        server.use(restify.dateParser());
        server.use(restify.queryParser());
        server.use(restify.bodyParser());
        server.use(restify.jsonp());
        server.use(restify.gzipResponse());
        server.pre(restify.pre.userAgentConnection());

        server.get('/search/:part/:year/:issue', function(req,res,next) {
            _find(new SvcContext(req,res,next));
        });
        server.get(/\/p2jsvc\/(.*)/, function(req, res, next) {
            req.params.file_name = req.params[0]
            _gfilter(new SvcContext(req, res, next));
        });

        server.post('/p2jsvc', function(req, res, next) {
	    var ctx = new SvcContext(req, res, next)
	    //nodeUtil.log(nodeUtil.format('req: %s', JSON.stringify(req) ));
            _gfilter(ctx);
        });

        server.get('/p2jsvc/status', function(req, res, next) {
            var jsObj = new SvcResponse(200, "OK", server.name, server.version);
            res.send(200, jsObj);
            return next();
        });

        server.listen(8001, function() {
            nodeUtil.log(nodeUtil.format('%s listening at %s', server.name, server.url));
        });
    };

    return cls;
})();

module.exports = new PDFFORMService();



