require 'debug'

a = 1
b = 2
binding.break                          # Program will stop here
c = 3
d = 4
binding.break                          # Program will stop here
p [a, b, c, d]
