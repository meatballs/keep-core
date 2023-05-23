package config

import (
	"embed"
	"fmt"
	"github.com/keep-network/keep-core/pkg/bitcoin"
	"github.com/keep-network/keep-core/pkg/bitcoin/electrum"
	"math/rand"
	neturl "net/url"
	"strings"
)

//go:embed _electrum_urls/*
var electrumURLs embed.FS

// readElectrumUrls reads Electrum URLs from an embedded file for the
// given Bitcoin network.
func readElectrumUrls(network bitcoin.Network) (
	[]*struct {
		host     string
		protocol electrum.Protocol
	},
	error,
) {
	file, err := electrumURLs.ReadFile(fmt.Sprintf("_electrum_urls/%s", network))
	if err != nil {
		return nil, fmt.Errorf("cannot read URLs file: [%v]", err)
	}

	urlsStrings := cleanStrings(strings.Split(string(file), "\n"))

	urls := make([]*struct {
		host     string
		protocol electrum.Protocol
	}, len(urlsStrings))

	for i, urlString := range urlsStrings {
		url, err := neturl.Parse(urlString)
		if err != nil {
			return nil, fmt.Errorf(
				"cannot parse URL with index [%v]: [%v]",
				i,
				err,
			)
		}

		protocol, ok := electrum.ParseProtocol(url.Scheme)
		if !ok {
			return nil, fmt.Errorf(
				"URL with index [%v] uses an unsupported Electrum protocol",
				i,
			)
		}

		urls[i] = &struct {
			host     string
			protocol electrum.Protocol
		}{
			host:     url.Host,
			protocol: protocol,
		}
	}

	return urls, nil
}

// resolveElectrum checks if Electrum is already configured. If the Electrum URL
// is empty it reads the Electrum configs from the embedded list for the given
// network and picks up one randomly.
func (c *Config) resolveElectrum() error {
	network := c.Bitcoin.Network

	// Return if Electrum is already set.
	if len(c.Bitcoin.Electrum.URL) > 0 {
		return nil
	}

	// For unknown and regtest networks we don't expect the Electrum configs to be
	// embedded in the client. The user should configure it in the config file.
	if network == bitcoin.Regtest || network == bitcoin.Unknown {
		logger.Warnf(
			"Electrum configs were not configured for [%s] network; "+
				"see bitcoin section in configuration",
			network,
		)
		return nil
	}

	logger.Debugf(
		"Electrum was not configured for [%s] bitcoin network; "+
			"reading defaults",
		network,
	)

	urls, err := readElectrumUrls(network)
	if err != nil {
		return fmt.Errorf("failed to read default Electrum URLs: [%v]", err)
	}

	// #nosec G404 (insecure random number source (rand))
	// Picking up an Electrum server does not require secure randomness.
	selectedUrl := urls[rand.Intn(len(urls))]

	// Set only the URL and Protocol fields in the original config. Other
	// fields may be already set, and we don't want to override them.
	c.Bitcoin.Electrum.URL = selectedUrl.host
	c.Bitcoin.Electrum.Protocol = selectedUrl.protocol

	return nil
}