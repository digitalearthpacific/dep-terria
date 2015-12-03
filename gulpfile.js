"use strict";

/*global require*/

var fs = require('fs');
var spawnSync = require('spawn-sync');
var glob = require('glob-all');
var gulp = require('gulp');
var gutil = require('gulp-util');
var browserify = require('browserify');
var jshint = require('gulp-jshint');
var jsdoc = require('gulp-jsdoc');
var sass  = require('gulp-ruby-sass');
var uglify = require('gulp-uglify');
var rename = require('gulp-rename');
var sourcemaps = require('gulp-sourcemaps');
var exorcist = require('exorcist');
var buffer = require('vinyl-buffer');
var transform = require('vinyl-transform');
var source = require('vinyl-source-stream');
var watchify = require('watchify');
var NpmImportPlugin = require('less-plugin-npm-import');
var jsoncombine = require('gulp-jsoncombine');
var child_exec = require('child_process').exec;  // child_process is built in to node

var appJSName = 'nationalmap.js';
var appCssName = 'nationalmap.css';
var specJSName = 'nationalmap-tests.js';
var appEntryJSName = './index.js';
var terriaJSSource = 'node_modules/terriajs/wwwroot';
var terriaJSDest = 'wwwroot/build/TerriaJS';
var testGlob = './test/**/*.js';

// Create the build directory, because browserify flips out if the directory that might
// contain an existing source map doesn't exist.
if (!fs.existsSync('wwwroot/build')) {
    fs.mkdirSync('wwwroot/build');
}

gulp.task('build-app', ['prepare-terriajs'], function() {
    return build(appJSName, appEntryJSName, false);
});

gulp.task('build-specs', ['prepare-terriajs'], function() {
    return build(specJSName, glob.sync(testGlob), false);
});

gulp.task('build-css', function() {
    return gulp.src('./index.less')
        .pipe(less({
            plugins: [
                new NpmImportPlugin()
            ]
        }))
        .pipe(rename(appCssName))
        .pipe(gulp.dest('./wwwroot/build/'));
});

gulp.task('build', ['sass', 'merge-datasources', 'build-app', 'build-specs', 'jsx']);

gulp.task('release-app', ['prepare'], function() {
    return build(appJSName, appEntryJSName, true);
});

gulp.task('release-specs', ['prepare'], function() {
    return build(specJSName, glob.sync(testGlob), true);
});

gulp.task('release', ['merge-datasources', 'release-app', 'release-specs']);

gulp.task('watch-app', ['prepare'], function() {
    return watch(appJSName, appEntryJSName, false);
});

gulp.task('watch-specs', ['prepare'], function() {
    return watch(specJSName, glob.sync(testGlob), false);
});

gulp.task('watch-css', ['build-css'], function() {
    return gulp.watch(['./index.less', './node_modules/terriajs/lib/Styles/*.less'], ['build-css']);
});

gulp.task('watch-datasource-groups', ['merge-groups'], function() {
    return gulp.watch('datasources/00_National_Data_Sets/*.json', [ 'merge-groups', 'merge-catalog' ]);
});

gulp.task('watch-datasource-catalog', ['merge-catalog'], function() {
    return gulp.watch('datasources/*.json', [ 'merge-catalog' ]);
});

gulp.task('watch-datasources', ['watch-datasource-groups','watch-datasource-catalog']);

gulp.task('watch-terriajs', ['prepare-terriajs'], function() {
    return gulp.watch(terriaJSSource + '/**', [ 'prepare-terriajs' ]);
});

gulp.task('watch', ['watch-app', 'watch-specs','watch-datasources', 'watch-terriajs', 'sass']);

gulp.task('lint', function(){
    return gulp.src(['lib/**/*.js', 'test/**/*.js'])
        .pipe(jshint())
        .pipe(jshint.reporter('default'))
        .pipe(jshint.reporter('fail'));
});

gulp.task('docs', function(){
    return gulp.src('lib/**/*.js')
        .pipe(jsdoc('./wwwroot/doc', undefined, {
            plugins : ['plugins/markdown']
        }));
});


gulp.task('styleguide', function(done) {
    child_exec('kss-node ./node_modules/terriajs/lib/Sass ./wwwroot/styleguide --template ./wwwroot/styleguide-template --css ./../build/nationalmap.css', undefined, done);
});

gulp.task('prepare', ['prepare-terriajs']);

gulp.task('prepare-terriajs', function() {
    return gulp
        .src([ terriaJSSource + '/**' ], { base: terriaJSSource })
        .pipe(gulp.dest(terriaJSDest));
});

gulp.task('merge-groups', function() {
    var jsonspacing=0;
    return gulp.src("./datasources/00_National_Data_Sets/*.json")
    .pipe(jsoncombine("00_National_Data_Sets.json", function(data) {
        // be absolutely sure we have the files in alphabetical order
        var keys = Object.keys(data).slice().sort();
        for (var i = 1; i < keys.length; i++) {
            data[keys[0]].catalog[0].items.push(data[keys[i]].catalog[0].items[0]);
        }
        return new Buffer(JSON.stringify(data[keys[0]], null, jsonspacing));
    }))
    .pipe(gulp.dest("./datasources"));
});

gulp.task('merge-catalog', ['merge-groups'], function() {
    var jsonspacing=0;
    return gulp.src("./datasources/*.json")
        .pipe(jsoncombine("nm.json", function(data) {
        // be absolutely sure we have the files in alphabetical order, with 000_settings first.
        var keys = Object.keys(data).slice().sort();
        data[keys[0]].catalog = [];

        for (var i = 1; i < keys.length; i++) {
            data[keys[0]].catalog.push(data[keys[i]].catalog[0]);
        }
        return new Buffer(JSON.stringify(data[keys[0]], null, jsonspacing));
    }))
    .pipe(gulp.dest("./wwwroot/init"));
});

gulp.task('merge-datasources', ['merge-catalog', 'merge-groups']);

gulp.task('default', ['lint', 'build']);

function bundle(name, bundler, minify, catchErrors) {
    // Get a version string from "git describe".
    var version = spawnSync('git', ['describe']).stdout.toString().trim();
    var isClean = spawnSync('git', ['status', '--porcelain']).stdout.toString().length === 0;
    if (!isClean) {
        version += ' (plus local modifications)';
    }

    fs.writeFileSync('version.js', 'module.exports = \'' + version + '\';');

    // Combine main.js and its dependencies into a single file.
    // The poorly-named "debug: true" causes Browserify to generate a source map.
    var result = bundler.bundle();

    if (catchErrors) {
        // Display errors to the user, and don't let them propagate.
        result = result.on('error', function(e) {
            gutil.log('Browserify Error', e.message);
        });
    }

    result = result
        .pipe(source(name))
        .pipe(buffer());

    if (minify) {
        // Minify the combined source.
        // sourcemaps.init/write maintains a working source map after minification.
        // "preserveComments: 'some'" preserves JSDoc-style comments tagged with @license or @preserve.
        result = result
            .pipe(sourcemaps.init({ loadMaps: true }))
            .pipe(uglify({preserveComments: 'some', mangle: true, compress: true}))
            .pipe(sourcemaps.write());
    }

    result = result
        // Extract the embedded source map to a separate file.
        .pipe(transform(function () { return exorcist('wwwroot/build/' + name + '.map'); }))

        // Write the finished product.
        .pipe(gulp.dest('wwwroot/build'));

    return result;
}

function build(name, files, minify) {
    return bundle(name, browserify({
        entries: files,
        debug: true
    }), minify, false);
}

function watch(name, files, minify) {
    var bundler = watchify(browserify({
        entries: files,
        debug: true,
        cache: {},
        packageCache: {}
    }));

    function rebundle(ids) {
        // Don't rebundle if only the version changed.
        if (ids && ids.length === 1 && /\/version\.js$/.test(ids[0])) {
            return;
        }

        var start = new Date();

        var result = bundle(name, bundler, minify, true);

        result.on('end', function() {
            console.log('Rebuilt ' + name + ' in ' + (new Date() - start) + ' milliseconds.');
        });

        return result;
    }

    bundler.on('update', rebundle);

    return rebundle();
}

var reactify = require('reactify');

// jsx transform task
gulp.task('jsx', function() {
  var b =  browserify({ debug:true });
  b.add(appEntryJSName)
   .transform(reactify)
  return b.bundle()
    .on('error', function (err) {
            console.log(err.toString());
            this.emit("end");
        })
    .pipe(source(appJSName))
    .pipe(gulp.dest('wwwroot/build'));
});

//compile sass, temp
gulp.task('sass', function(){
  return sass('nationalmap.scss',{
          style: 'expanded',
          loadPath: './node_modules/terriajs/lib/Sass'
        })
        .pipe(gulp.dest('wwwroot/build'));
});

//watch js and sass compile
gulp.task('new-watch', function(){
  gulp.watch(['./node_modules/terriajs/lib/ReactViews/**', 'index.js'],  ['jsx']);
  gulp.watch(['./node_modules/terriajs/lib/Sass/**', 'nationalmap.scss'], ['sass']);
});

//watch sass compile and update doc
gulp.task('sass-watch', function(){
  gulp.watch(['./node_modules/terriajs/lib/Sass/**', 'nationalmap.scss'], ['sass', 'styleguide']);
});



