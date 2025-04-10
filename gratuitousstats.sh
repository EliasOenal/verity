totalsrc=$(find src -type f | xargs wc -l | tail -n 1 | awk '{print $1}')
totaltest=$(find test -type f | xargs wc -l | tail -n 1 | awk '{print $1}')

identitysrc=$(find src/cci/identity -type f | xargs wc -l | tail -n 1 | awk '{print $1}')
identitytest=$(find test/cci/identity -type f | xargs wc -l | tail -n 1 | awk '{print $1}')

identitysrcpct=$(echo "$identitysrc/$totalsrc * 100" | bc -l | grep -Po "\d*\.\d?\d?")
identitytestpct=$(echo "$identitytest/$totaltest * 100" | bc -l | grep -Po "\d*\.\d?\d?")

echo 'Gratuitous project stats!'
echo
echo Project total:
echo $totalsrc lines of src code
echo $totaltest lines of test code
echo
echo Of which the Identity module alone accounts for:
echo $identitysrc lines or $identitysrcpct% of src code
echo $identitytest lines or $identitytestpct% of test code
echo 😂😅🤷

