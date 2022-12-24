# VSCode Ruby rdbg Debugger

Ruby debugger to connect [debug](https://github.com/ruby/debug) library which utilize recent Ruby's debug support features.

## Requirement

You need to install latest `debug` gem and `rdbg` command should be in `$PATH`.

```shell
$ gem install debug
```

## How to use

### Launch without configuration

Without any configuration, you can use this debugger by "Start Debugging" (F5 key) if you activate `.rb` file.

You will see the "Debug command line" input dialog.
Please specify your favorite command line you want to debug.

For example:
* `ruby foo.rb` (launch `foo.rb`)
* `ruby foo.rb 10 20 30` (launch `foo.rb` with options `10`, `20` and `30`)
* `rake taskA` (launch `rake` task `taskA`)
* `bundle exec rspec` (launch `rspec` command with `bundle exec`)
* `bin/rails s` (launch `bin/rails s`)

When you select a command line, the specified command will run on `rdbg` debugger, and VSCode will connect to the `rdbg` debugger with UNIX domain socket.

And new terminal is created (named `rdbg`).
You can see stdout/err outputs and you can input stdin on `rdbg` terminal.

You can stop the programs

* by setting breakpoints (F9) on source code.
* by exception (if you enable "rescue exception").
* by pushing the Pause button (F6).

When the program stops, you can see "Call stack", "Variables" and you can set "Watch" expressions.
On the debug console, you can input valid Ruby program and you will get an evaluation result on selected context ("Call stack").

See also: [Debugging in Visual Studio Code](https://code.visualstudio.com/docs/editor/debugging)

For developers: `RUBY_DEBUG_DAP_SHOW_PROTOCOL=1` on `rdbg` terminal will show the all DAP protocol.

### Launch with configurations

You can write your favorite setting in `.vscode/launch.json`.

To make a `.vscode/launch.json` with default settings, you only need to click "create a launch.json file" on the "Run and Debug" pane. And you will see the following default configurations.

```jsonc
{
        // Use IntelliSense to learn about possible attributes.
        // Hover to view descriptions of existing attributes.
        // For more information, visit: https://go.microsoft.com/fwlink/?linkid=830387
        "version": "0.2.0",
        "configurations": [
                {
                        "type": "rdbg",
                        "name": "Debug current file with rdbg",
                        "request": "launch",
                        "script": "${file}",
                        "args": [],
                        "askParameters": true
                },
                {
                        "type": "rdbg",
                        "name": "Attach with rdbg",
                        "request": "attach"
                }
        ]
}
```

It contains "Debug current file with rdbg" (launch) configuration and "Attach with rdbg" (attach) configuration.
You can modify this configuration, and also you can add your favorite configuration like:

```jsonc
                {
                        "type": "rdbg",
                        "name": "Run rake test",
                        "request": "launch",
                        "command": "rake",
                        "script": "test", // launch rake test with debugger
                        "args": [],
                        "askParameters": false // Do not ask startup parameter any more
                },
```

You can use the following "launch" configurations.

* Debuggee settings
  * `script`
    * A target script file name.
    * default: an active ruby file on VSCode
  * `command`
    * Executable Ruby command. You can specify `bundle exec ruby` for example.
    * default: `ruby`
  * `cwd`
    * Directory to execute the program in.
    * default: `${workspaceFolder}`
  * `args`
    * Command line arguments passed to the program.
    * default: `[]`
  * `env`
    * Additional environment variables to pass to the debugging (and debugged) process.
    * default: N/A
  * `useBundler`:
    * Execute Ruby programs with `bundle exec` if `command` configuration is not given. and `Gemfile` is available in the workspace.
    * Note that you can specify this `useBundler` by the extension configuration (default: true).
    * default: undefined (and the extention configuration default value is `true`)
* Behavir settings
  * `askParameters`
    * Ask "Debug command line" before debugging. If the MAIN program is always same, set it false.
    * Note that the last invoked command is rememberred.
    * default: true
  * `rdbgPath`
    * Location of the rdbg executable.
    * Note that you can specify this `rdbgPath` by the extension configuration (default: `rdbg`).
    * default: `rdbg`
  * `debugPort`
    * Without `debugPort` configulation, open a UNIX Domain Socket (or TCP/IP `localhost:0` on Windows) to communicate with debuggee. If you want to use another debug port, set this configuration.
      * Digits (e.g. `12345`): open a TCP/IP debug port with port `12345`
      * `hostname:port` (e.g. `hostname:12345`): open a TCP/IP port `12345` and hostname `hostname`
      * Otherwize, open a UNIX Domain socket with the filename given by this configration.
    * Note that you can specify `0` TCP/IP port (choose usable port) with debug.gem v1.5.0 or later.
  * `waitLaunchTime`
    * If you want to open TCP/IP debug port, you may need to wait for opening debug port. On default, it waits 1000 milli seconds (1 sec) but if it is not enough, please specify more wait time (default: `1000` in milli seconds).
    * With debug.gem 1.5.0 and later you may not need this configulation.
  * `useTerminal`
    * If the configuration is true, create a new terminal and then execute the debug command line there. It is a bit slower.
    * Otherwise, all outputs to the STDIN/OUT are shown in the DEBUG CONSOLE.
    * If you need to use STDIN, please set this option.
    * default: false
  * `showProtocolLog`
    * Prints all DAP communication log in "rdbg" output. This is for development of this extension.
    * default: false

Note that if you have a trouble by launching `rdbg`, please try to specify `rdbgPath`. Without this configuration, this extension simply calls `rdbg` in PATH.

### Attach to the running Ruby process

You can attach to a Ruby process which run with an opening debugger port.

The following commands starts the `foo.rb` with opening debug port. There are more methods to open the port. See more for [ruby/debug: Debugging functionality for Ruby](https://github.com/ruby/debug).

```shell
# With rdbg command
$ rdbg --open foo.rb              # open debug port. -O is short for --open
$ rdbg -n -O foo.rb               # do not stop at the beggining of application
$ rdbg -O -c -- bundle exec rspec # run rspec with remote

# With debug/open lib
$ ruby -r debug/open foo.rb
$ ruby -r debug/open_nonstop foo.rb # do not stop at the beggining of application

# If your application requires debug/open (or debug/open_nonstop) explictly, of course -r is not needed.
$ ruby foo.rb

# With debug lib with RUBY_DEBUG_OPEN
$ RUBY_DEBUG_OPEN=true ruby -r debug foo.rb

# If your application requires debug explictly, of course -r is not needed.
$ RUBY_DEBUG_OPEN=true ruby foo.rb

# If your Gemfile has a line `gem 'debug'` with Rails, you only need to launch it with the `RUBY_DEBUG_OPEN` envval.
$ RUBY_DEBUG_OPEN=true raise server
```

After that, you can connect to the debug port. This extension searches opening debugger port and attach to that port by running `Attach with rdbg` (select it on the top of "RUN AND DEBUG" pane and push the green "Start Debugging" button).

You can specify the following "attach" configurations.

* `rdbgPath`
  * Same as `launch` request.
* `debugPort`
  * Same as `launch` request.
* `localfs`
  * On TCP/IP, if target host is local machine, set `true` and you can open the file directly
  * default: false
* `localfsMap`
  * Specify pairs of remote root path and local root path like `/remote_dir:/local_dir` if sharing the same source reposiroty with local and remote computers.
  * You can specify multiple pairs like `/rem1:/loc1,/rem2:/loc2` by concatenating with `,`.
  * default: undefined

Without `debugPort` configuration, the

With `debugPort`, you can attach to TCP/IP debug port.

* Start your debuggee command with a TCP/IP debug port with debug.gem configurations.
  * Using `rdbg` command like: `rdbg --open --port 12345 foo.rb`
  * Using `debug/open` lib: `RUBY_DEBUG_PORT=12345 ruby -r debug/open foo.rb`
  * Using `debug` lib with `RUBY_DEBUG_OPEN` envval: `RUBY_DEBUG_OPEN=true RUBY_DEBUG_PORT=12345 ruby -r debug foo.rb`
* On VSCode (debugger-side):
  * Add `debugPort: '12345'` attach configration.
  * Choose `Attach with rdbg` and start attach debugging

`localfsMap` is helpful if you run the debuggee and share the same file system with another name in debuggee.

For example, running a docker container with `-v` option (and `--network=host` to communicate with the host and a docker container) option like that:

```
$ docker run --network=host -it -v `pwd`:/app/ --rm ruby bash
/:# cd app
/app:# rdbg -O --port=12345 target.rb
```

In this case, the current directory of host (`${workspaceFolder}`) is shared with the name `/app` in a container and VSCode on the host can connect to the debuggee process in a container by TCP/IP port 12345. The `launch.json` configuration should be:

```JSONC
        {
            "type": "rdbg",
            "name": "Attach with rdbg (tcp 12345)", // Specify your favorite name
            "request": "attach",
            "debugPort": "localhost:12345",
            "localfsMap": "/app:${workspaceFolder}"
        }
```

## Acknowledgement

* This extension is based on [Ethan Reesor / VSCode Byebug · GitLab](https://gitlab.com/firelizzard/vscode-byebug/-/tree/master/) by Ethan Reesor. Without his great work, the extension can not be released (Koichi learned TypeScript, VSCode extension and DAP by his extension).
* Icon is by [@firien](https://github.com/firien) (https://github.com/ruby/vscode-rdbg/pull/74).
